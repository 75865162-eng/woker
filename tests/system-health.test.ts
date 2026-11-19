import assert from "node:assert/strict";
import test from "node:test";

import {
  getAccessiblePathOrFallback,
  getModuleIdForPath,
  parseRolePermissionsCookie,
  roleCanAccessModule,
  roleCanPerformAction,
} from "@/lib/accounts/permissions";
import { getRosterLoginName } from "@/lib/accounts/roster-auth-sync";
import { parseCsv, readNumber } from "@/lib/bulk/row-utils";
import { buildGroupsFromRows, toPerformanceRow } from "@/lib/bulk/workspace-builders";
import { aggregateMetrics } from "@/lib/metrics";
import {
  buildLaunchOverdueAlerts,
  createSentRecords,
  validateWeComWebhookUrl,
} from "@/lib/notifications/wecom";
import { nextAppVersionLabel, normalizeAppVersionLabel } from "@/lib/app-version";
import { getProductListImage } from "@/lib/products/image-assets";
import { productToDraft, parseProductWorkbookFile } from "@/components/products/product-workbench-data";
import { createProductShellFromListItem } from "@/components/products/product-workbench-data";
import { buildAmazonLink, buildAmazonSearchLink, calculateExcelPricing, calculatePeakStandardNonApparelFbaFee, calculateTrialPricing, parseOptionalProductNumber, nextSku } from "@/components/products/product-workbench-utils";
import type { TrialPriceRow } from "@/components/products/product-workbench-model";
import { runRuleEngine } from "@/lib/rule-engine/engine";
import { normalizeWorkspaceScope, workspaceScopeFromRequest } from "@/lib/workspace/scope";
import type { CampaignGroup, PerformanceRow, Rule } from "@/lib/types";
import type { Product } from "@/lib/products/types";
import { buildProductRecordIndex, ProductPurchasePriceValidationError, requireProductPurchasePrice } from "@/lib/products/product-record-index";
import { createProductRecordData, saveProductRecord } from "@/lib/products/product-record-repository";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildProductSummaryProjection, productRecordPayloadToProduct } from "@/lib/products/product-projection";

function createPerformanceRow(overrides: Partial<PerformanceRow> = {}): PerformanceRow {
  return {
    id: "row-1",
    campaignGroupId: "group-1",
    batchId: "batch-1",
    sheetName: "Sponsored Products Campaigns",
    sourceRowIndex: 2,
    sourceRowNumber: 2,
    entity: "Keyword",
    adGroupNameRef: "Ad Group A",
    campaignName: "Campaign A",
    adGroupName: "Ad Group A",
    keyword: "wireless charger",
    target: "wireless charger",
    matchType: "exact",
    currentBid: 1,
    impressions: 1_000,
    clicks: 50,
    orders: 5,
    sales: 100,
    spend: 50,
    topOfSearchShare: 0,
    advertisedProductOrders: 0,
    otherProductOrders: 0,
    viewableImpressions: 0,
    status: "enabled",
    ...overrides,
  };
}

function createCampaignGroup(overrides: Partial<CampaignGroup> = {}): CampaignGroup {
  return {
    id: "group-1",
    sheetName: "Sponsored Products Campaigns",
    campaignName: "Campaign A",
    adGroupName: "Ad Group A",
    lifecycleGroupId: "launch",
    keywordCount: 1,
    lastUpdated: "2026-07-01",
    ...overrides,
  };
}

test("workspace scope normalization keeps request-body values ahead of headers and query parameters", () => {
  const request = new Request(
    "https://example.test/api/workspaces?workspaceId=query&accountId=query-account&marketplace=ca",
    {
      headers: {
        "x-workspace-id": "header",
        "x-account-id": "header-account",
        "x-marketplace": "us",
      },
    },
  );

  assert.deepEqual(normalizeWorkspaceScope({ workspaceId: "  ", marketplace: " us " }), {
    workspaceId: "default",
    accountId: "",
    marketplace: "US",
  });
  assert.deepEqual(
    workspaceScopeFromRequest(request, { workspaceId: "body", marketplace: "mx" }),
    { workspaceId: "body", accountId: "header-account", marketplace: "MX" },
  );
});

test("bulk CSV parsing builds executable sponsored-product keyword rows and metrics", () => {
  const [csvRow] = parseCsv(
    [
      "Entity,Campaign Name (Informational only),Ad Group Name (Informational only),Keyword Text,Bid,Impressions,Clicks,Spend,Sales,Orders,State",
      'Keyword,"Campaign, A",Ad Group A,wireless charger,$1.25,"1,000",50,$25.00,$100.00,5,enabled',
    ].join("\n"),
  );
  const row = toPerformanceRow(csvRow, "Sponsored Products Campaigns", "batch-1", 2);

  assert.ok(row);
  assert.equal(row.campaignName, "Campaign, A");
  assert.equal(row.currentBid, 1.25);
  assert.equal(row.impressions, 1000);
  assert.equal(readNumber(csvRow, ["Spend"]), 25);

  const metrics = aggregateMetrics(row.campaignGroupId, row.batchId, [row]);
  assert.equal(metrics.acos, 25);
  assert.equal(metrics.cvr, 10);

  const groups = buildGroupsFromRows([], [row]);
  assert.equal(groups[0]?.keywordCount, 1);
  assert.equal(groups[0]?.adGroupName, "Ad Group A");
});

test("rule engine produces an auditable bid draft and respects the minimum bid floor", () => {
  const campaignGroup = createCampaignGroup();
  const rule: Rule = {
    id: "launch-high-acos",
    name: "High ACOS bid reduction",
    lifecycleGroupId: "launch",
    enabled: true,
    priority: 1,
    conditionGroup: {
      id: "conditions",
      logic: "AND",
      conditions: [{ id: "acos", metric: "acos", operator: "gte", value: 40 }],
    },
    actions: [{ id: "reduce", type: "decrease_bid_percent", value: 20 }],
    updatedAt: "2026-08-25T00:00:00.000Z",
  };

  const drafts = runRuleEngine({
    campaignGroup,
    rows: [createPerformanceRow()],
    rules: [rule],
  });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.oldValue, 1);
  assert.equal(drafts[0]?.newValue, 0.8);
  assert.match(drafts[0]?.reason ?? "", /High ACOS bid reduction/);

  const floorDraft = runRuleEngine({
    campaignGroup,
    rows: [createPerformanceRow({ currentBid: 0.02, spend: 100, sales: 100 })],
    rules: [
      {
        ...rule,
        actions: [{ id: "reduce-to-floor", type: "decrease_bid_percent", value: 90 }],
      },
    ],
  });
  assert.equal(floorDraft[0]?.newValue, 0.02);
});

test("permission checks map nested routes and reject malformed permission cookies", () => {
  assert.equal(getModuleIdForPath("/workspace/import"), "workspace");
  assert.equal(getModuleIdForPath("/sellfox"), "sellfox");
  assert.equal(getModuleIdForPath("/sellfox/performance"), "sellfox");
  assert.equal(getModuleIdForPath("/agents/market"), "agents");
  assert.equal(getModuleIdForPath("/rules"), null);
  assert.equal(getModuleIdForPath("/not-a-module"), null);
  assert.equal(roleCanAccessModule("viewer", "workspace"), false);
  assert.equal(roleCanAccessModule("operations", "sellfox"), true);
  assert.equal(roleCanAccessModule("warehouse", "sellfox"), false);
  assert.equal(roleCanAccessModule("operations", "agents"), true);
  assert.equal(roleCanPerformAction("ppc_specialist", "workspace", "export"), true);
  assert.equal(roleCanPerformAction("operations", "workspace", "view"), false);
  assert.equal(getAccessiblePathOrFallback("/product", "operations"), "/product");
  assert.equal(getAccessiblePathOrFallback("/accounts", "operations"), "/");
  assert.equal(parseRolePermissionsCookie("%7Bbad-json"), null);
});

test("roster login names are normalized for case-insensitive sign in", () => {
  assert.equal(
    getRosterLoginName({ id: "user-1", email: "", username: " SF1785054571062888 " }),
    "sf1785054571062888",
  );
  assert.equal(
    getRosterLoginName({ id: "user-2", email: "person@example.com", phone: " 13800138000 " }),
    "13800138000",
  );
});

test("WeCom launch alerts validate the official webhook and prevent duplicate same-day notifications", () => {
  const group = createCampaignGroup({ lastUpdated: "2026-07-01" });
  const now = new Date("2026-08-25T08:00:00.000Z");
  const alerts = buildLaunchOverdueAlerts({
    campaignGroups: [group],
    performanceRows: [createPerformanceRow()],
    launchOverdueDays: 14,
    now,
    notifyOncePerDay: true,
  });

  assert.equal(validateWeComWebhookUrl("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc"), true);
  assert.equal(validateWeComWebhookUrl("https://example.test/cgi-bin/webhook/send?key=abc"), false);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.metrics.acos, 50);

  const duplicateAlerts = buildLaunchOverdueAlerts({
    campaignGroups: [group],
    performanceRows: [createPerformanceRow()],
    launchOverdueDays: 14,
    now,
    notifyOncePerDay: true,
    sentRecords: createSentRecords(alerts, now),
  });
  assert.equal(duplicateAlerts.length, 0);
});

test("productToDraft tolerates legacy products with missing array fields", () => {
  const product = {
    id: "prod-1",
    sku: "SKU-1",
    chineseName: "Test",
    englishName: "",
    asin: "",
    developer: "",
    purchasePrice: 0,
    status: "pending",
    supplierName: "",
    supplierUrl: "",
    specs: "",
    purchaseLeadTime: "",
    createdAt: "2026-09-02T00:00:00.000Z",
    keywords: "",
    note: "",
    cancelReason: "",
    hsCode: "",
    productWeightG: 0,
    packageWeightG: 0,
    productSizeCm: { length: 0, width: 0, height: 0 },
    packageSizeCm: { length: 0, width: 0, height: 0 },
  } as Product;

  const draft = productToDraft(product, [{ sku: "SKU-2" }]);

  assert.deepEqual(draft.images, []);
  assert.deepEqual(draft.competitorAsins, [""]);
  assert.deepEqual(draft.workflowHistory, []);
});

test("商品列表壳与新建草稿保留缺失数值并区分真实零", () => {
  const item = { id: "null-product", sku: "NULL-1", chineseName: "空值商品", englishName: "", status: "pending" } satisfies Pick<Product, "id" | "sku" | "chineseName" | "englishName" | "status">;
  for (const purchasePrice of [undefined, 0, 12.5]) {
    const shell = createProductShellFromListItem({ ...item, purchasePrice });
    const draft = productToDraft(shell, []);
    assert.equal(draft.purchasePrice, purchasePrice ?? null);
    assert.equal(draft.productWeightG, null);
    assert.equal(draft.packageWeightG, null);
    assert.deepEqual(draft.productSizeCm, { length: null, width: null, height: null });
    assert.deepEqual(draft.packageSizeCm, { length: null, width: null, height: null });
  }
  const blank = productToDraft(null, []);
  assert.equal(blank.purchasePrice, null);
  assert.equal(blank.workbookDetail.pricingRows[0].purchaseCost, null);
  const product = { ...createProductShellFromListItem(item), purchasePrice: 0, productWeightG: 0, packageWeightG: 120, productSizeCm: null, packageSizeCm: { length: 0, width: null, height: 3 } };
  const draft = productToDraft(product, []);
  assert.equal(draft.purchasePrice, 0);
  assert.equal(draft.productWeightG, 0);
  assert.equal(draft.packageWeightG, 120);
  assert.equal(draft.productSizeCm, null);
  assert.deepEqual(draft.packageSizeCm, product.packageSizeCm);
});

test("实际选品工作簿导入区分缺失零与正常商品数值", async () => {
  const XLSX = await import("xlsx");
  for (const value of ["", 0, 2.5]) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["品名", "长", "宽", "高", "重量"],
      ["导入测试", value, value, value, value, "", 20, value, 3],
      ["ASIN"],
      ["供应商产品链接"],
      ["使用人群"],
      [""],
      ["关键词"],
    ]), "选品");
    const bytes: ArrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const product = await parseProductWorkbookFile(new File([bytes], "import.xlsx"), [], "IMPORT-1");
    assert.equal(product.purchasePrice, value === "" ? null : value);
    const expectedWeight = typeof value === "number" ? value * 1000 : null;
    assert.equal(product.productWeightG, expectedWeight);
    assert.equal(product.packageWeightG, expectedWeight);
    assert.deepEqual(product.productSizeCm, { length: value === "" ? null : value, width: value === "" ? null : value, height: value === "" ? null : value });
  }
});

test("采购价存储边界拒绝缺失且保留真实零", () => {
  assert.throws(() => requireProductPurchasePrice({ purchasePrice: null }), ProductPurchasePriceValidationError);
  assert.throws(() => requireProductPurchasePrice({ purchasePrice: Number.NaN }), ProductPurchasePriceValidationError);
  assert.equal(requireProductPurchasePrice({ purchasePrice: 0 }), 0);
  assert.equal(requireProductPurchasePrice({ purchasePrice: 12.5 }), 12.5);
});

test("无效采购价在任何事务访问前抛明确业务错误", async () => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://fixture:fixture@127.0.0.1:1/never_connect" }) });
  let accesses = 0;
  const tx = new Proxy(client, { get() { accesses += 1; throw new Error("测试禁止任何事务访问"); } });
  const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace", accountId: "fixture-account", marketplace: "US" };
  const user = { id: "fixture-user", organizationId: scope.organizationId };
  const shell = createProductShellFromListItem({ id: "transaction-guard", sku: "GUARD-1", chineseName: "事务前校验", englishName: "", status: "pending" });
  for (const purchasePrice of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(saveProductRecord(tx, { product: { ...shell, purchasePrice }, user, scope }), ProductPurchasePriceValidationError);
    assert.equal(accesses, 0);
  }
});

test("商品实际持久化映射拒绝缺失且保留零与有效采购价", () => {
  const shell = createProductShellFromListItem({ id: "price-boundary", sku: "PRICE-1", chineseName: "采购价边界", englishName: "", status: "pending" });
  const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace", accountId: "fixture-account", marketplace: "US" };
  const user = { id: "fixture-user", organizationId: scope.organizationId };
  for (const purchasePrice of [null, Number.NaN, Number.POSITIVE_INFINITY, 0, 12.5]) {
    const candidate = { ...shell, purchasePrice };
    const buildRecord = () => createProductRecordData(candidate, user, scope);
    const buildIndex = () => buildProductRecordIndex(candidate);
    const buildSummary = () => buildProductSummaryProjection({ product: candidate, ...scope, sourceRevision: 1 });
    if (purchasePrice === null || !Number.isFinite(purchasePrice)) {
      assert.throws(buildRecord, ProductPurchasePriceValidationError);
      assert.throws(buildIndex, ProductPurchasePriceValidationError);
      assert.throws(buildSummary, ProductPurchasePriceValidationError);
    } else {
      const record = buildRecord();
      assert.equal(record.purchasePrice, purchasePrice);
      assert.equal(buildIndex().purchasePrice, purchasePrice);
      assert.equal(buildSummary().purchasePrice, purchasePrice);
      assert.equal(JSON.parse(JSON.stringify(record.payload)).purchasePrice, purchasePrice);
    }
  }
});

test("历史商品JSON缺失采购价可读取且草稿不伪造零值", () => {
  for (const payload of [
    { id: "legacy-missing", sku: "LEGACY-MISSING", chineseName: "历史缺失", englishName: "", status: "pending", createdAt: "2026-11-01" },
    { id: "legacy-null", sku: "LEGACY-NULL", chineseName: "历史空值", englishName: "", status: "pending", createdAt: "2026-11-01", purchasePrice: null },
  ]) {
    const product = productRecordPayloadToProduct(payload);
    assert.equal(product.purchasePrice, payload.purchasePrice);
    const draft = productToDraft(product, []);
    assert.equal(draft.purchasePrice, payload.purchasePrice);
    assert.notEqual(draft.purchasePrice, 0);
  }
});

test("商品数值输入解析保留空白与真实零", () => {
  for (const value of [null, undefined, "", "   ", "invalid", Number.NaN]) assert.equal(parseOptionalProductNumber(value), null);
  assert.equal(parseOptionalProductNumber("0"), 0);
  assert.equal(parseOptionalProductNumber(0), 0);
  assert.equal(parseOptionalProductNumber("12.5"), 12.5);
});

test("商品真实试算函数区分缺失零和正常输入", () => {
  const row: TrialPriceRow = { name: "测试", lengthCm: 10, widthCm: 10, heightCm: 6, actualWeightKg: 0.2, suggestedPrice: 20, purchaseCost: 7, oceanFreightUnitPrice: 12, fbaFee: 3, exchangeRate: 7 };
  for (const calculate of [calculateExcelPricing, calculateTrialPricing]) {
    assert.equal(calculate(row).volumeWeightKg, 0.1);
    assert.ok(Number.isFinite(calculate(row).profit));
    const normalProfit = calculate(row).profit;
    const zeroCostProfit = calculate({ ...row, purchaseCost: 0 }).profit;
    assert.notEqual(normalProfit, null);
    assert.notEqual(zeroCostProfit, null);
    assert.ok(normalProfit !== null && zeroCostProfit !== null && zeroCostProfit > normalProfit);
    assert.equal(calculate({ ...row, lengthCm: 0 }).volumeWeightKg, 0);
    for (const key of ["lengthCm", "widthCm", "heightCm", "actualWeightKg", "suggestedPrice", "purchaseCost", "oceanFreightUnitPrice", "fbaFee", "exchangeRate"] as const) {
      const result = calculate({ ...row, [key]: null });
      if (calculate === calculateExcelPricing && key === "fbaFee") {
        assert.ok(Number.isFinite(result.profit));
      } else {
        assert.ok(Object.entries(result).filter(([metric]) => metric !== "automaticFbaFee").every(([, value]) => value === null), key);
      }
    }
    assert.equal(calculate({ ...row, exchangeRate: 0 }).profit, null);
    assert.equal(calculate({ ...row, purchaseCost: Number.NaN }).profit, null);
  }
});

test("商品自动FBA费用复用旺季参考档位并仅加一次燃油", () => {
  const row: TrialPriceRow = { name: "费率边界", lengthCm: 10, widthCm: 10, heightCm: 6, actualWeightKg: 2.9 / 2.2046226218, suggestedPrice: 20, purchaseCost: 7, oceanFreightUnitPrice: 12, fbaFee: null, exchangeRate: 7 };
  assert.equal(calculatePeakStandardNonApparelFbaFee(row), 7.08);
  assert.equal(calculatePeakStandardNonApparelFbaFee({ ...row, suggestedPrice: 9 }), 6.26);
  assert.equal(calculatePeakStandardNonApparelFbaFee({ ...row, suggestedPrice: 51 }), 7.34);
  const auto = calculateExcelPricing(row);
  assert.equal(auto.automaticFbaFee, 7.08);
  assert.equal(auto.fuelFee, 7.08 * 0.035);
  assert.equal(auto.profit, calculateExcelPricing({ ...row, fbaFee: 7.08 }).profit);
  // 表格把 0 视为“未填”，自动回落到参考档位，燃油仍只按最终 FBA 费用加一次。
  assert.equal(calculateExcelPricing({ ...row, fbaFee: 0 }).fuelFee, 7.08 * 0.035);
  assert.equal(calculateExcelPricing({ ...row, purchaseCost: null }).automaticFbaFee, 7.08);
  assert.equal(calculateExcelPricing({ ...row, purchaseCost: null }).profit, null);
  assert.equal(calculatePeakStandardNonApparelFbaFee({ ...row, lengthCm: 100 }), null);
  for (const value of [null, 0, -1, Number.NaN, Infinity]) {
    assert.equal(calculatePeakStandardNonApparelFbaFee({ ...row, heightCm: value }), null);
  }
  // Small standard uses actual weight, without dimensional-weight escalation.
  assert.equal(calculatePeakStandardNonApparelFbaFee({ ...row, lengthCm: 15 * 2.54, widthCm: 12 * 2.54, heightCm: 0.75 * 2.54, actualWeightKg: 0.1 / 2.2046226218 }), 3.51);
});

test("product list shells preserve lightweight thumbnails for the table view", () => {
  const shell = createProductShellFromListItem({
    id: "prod-1",
    sku: "SKU-1",
    chineseName: "Test",
    englishName: "",
    status: "pending",
    image: "https://example.com/thumb.webp",
  });

  assert.equal(getProductListImage(shell), "https://example.com/thumb.webp");
});

test("productToDraft preserves legacy image URLs without creating fake file downloads", () => {
  const product = {
    id: "prod-1",
    sku: "SKU-1",
    chineseName: "Test",
    englishName: "",
    asin: "",
    developer: "",
    purchasePrice: 0,
    status: "pending",
    supplierName: "",
    supplierUrl: "",
    specs: "",
    purchaseLeadTime: "",
    createdAt: "2026-09-02T00:00:00.000Z",
    keywords: "",
    note: "",
    cancelReason: "",
    hsCode: "",
    images: [],
    imageAssets: [{
      id: "",
      name: "legacy.png",
      mimeType: "image/png",
      size: 0,
      storageType: "local",
      uploadedAt: "",
      thumbUrl: "",
      originalUrl: "https://example.com/legacy.png",
    }],
    competitorAsins: [],
    productWeightG: 0,
    packageWeightG: 0,
    productSizeCm: { length: 0, width: 0, height: 0 },
    packageSizeCm: { length: 0, width: 0, height: 0 },
  } as Product;

  const draft = productToDraft(product, []);

  assert.deepEqual(draft.images, ["https://example.com/legacy.png"]);
  assert.equal(draft.imageAssets?.[0]?.id, "product-image-SKU-1-1");
  assert.equal(getProductListImage({ imageAssets: draft.imageAssets }), "https://example.com/legacy.png");
});

test("productToDraft hydrates legacy image arrays into displayable image assets", () => {
  const product = {
    id: "prod-legacy",
    sku: "SKU-LEGACY",
    chineseName: "Legacy",
    englishName: "",
    asin: "",
    developer: "",
    purchasePrice: 0,
    status: "pending",
    supplierName: "",
    supplierUrl: "",
    specs: "",
    purchaseLeadTime: "",
    createdAt: "2026-09-02T00:00:00.000Z",
    keywords: "",
    note: "",
    cancelReason: "",
    hsCode: "",
    images: ["data:image/png;base64,legacy", "https://example.com/legacy-2.webp"],
    competitorAsins: [],
    productWeightG: 0,
    packageWeightG: 0,
    productSizeCm: { length: 0, width: 0, height: 0 },
    packageSizeCm: { length: 0, width: 0, height: 0 },
  } as Product;

  const draft = productToDraft(product, []);

  assert.equal(draft.imageAssets?.length, 1);
  assert.equal(draft.imageAssets?.[0]?.thumbUrl, "https://example.com/legacy-2.webp");
  assert.deepEqual(draft.images, ["https://example.com/legacy-2.webp"]);
});

test("nextSku uses the 0000-9999 range before switching to letter-prefixed SKUs", () => {
  assert.equal(nextSku([{ sku: "0000" }]), "0001");
  assert.equal(nextSku([{ sku: "9999" }]), "A001");
  assert.equal(nextSku([{ sku: "A999" }]), "B001");
});

test("Amazon link helpers tolerate missing legacy values", () => {
  assert.equal(buildAmazonLink(undefined), "");
  assert.equal(buildAmazonLink(null), "");
  assert.equal(buildAmazonLink("  B0ABC  "), "https://www.amazon.com/dp/B0ABC");
  assert.equal(buildAmazonSearchLink(undefined), "");
  assert.equal(buildAmazonSearchLink("wireless keyboard"), "https://www.amazon.com/s?k=wireless%20keyboard");
});

test("app version labels normalize and increment sequentially", () => {
  assert.equal(normalizeAppVersionLabel("v0.0.1"), "v0.0.1");
  assert.equal(normalizeAppVersionLabel("bad-value"), "v0.0.1");
  assert.equal(nextAppVersionLabel("v0.0.1"), "v0.0.2");
  assert.equal(nextAppVersionLabel("v0.0.9"), "v0.0.10");
  assert.equal(nextAppVersionLabel("bad-value"), "v0.0.1");
});
