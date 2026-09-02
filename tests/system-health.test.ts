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
import { productToDraft } from "@/components/products/product-workbench-data";
import { nextSku } from "@/components/products/product-workbench-utils";
import { runRuleEngine } from "@/lib/rule-engine/engine";
import { normalizeWorkspaceScope, workspaceScopeFromRequest } from "@/lib/workspace/scope";
import type { CampaignGroup, PerformanceRow, Rule } from "@/lib/types";
import type { Product } from "@/lib/products/types";

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
  assert.equal(getModuleIdForPath("/rules"), null);
  assert.equal(getModuleIdForPath("/not-a-module"), null);
  assert.equal(roleCanAccessModule("viewer", "workspace"), false);
  assert.equal(roleCanPerformAction("ppc_specialist", "workspace", "export"), true);
  assert.equal(roleCanPerformAction("operations", "workspace", "view"), false);
  assert.equal(getAccessiblePathOrFallback("/dashboard", "operations"), "/dashboard");
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

test("nextSku uses the 0000-9999 range before switching to letter-prefixed SKUs", () => {
  assert.equal(nextSku([{ sku: "0000" }]), "0001");
  assert.equal(nextSku([{ sku: "9999" }]), "A001");
  assert.equal(nextSku([{ sku: "A999" }]), "B001");
});

test("app version labels normalize and increment sequentially", () => {
  assert.equal(normalizeAppVersionLabel("v0.0.1"), "v0.0.1");
  assert.equal(normalizeAppVersionLabel("bad-value"), "v0.0.1");
  assert.equal(nextAppVersionLabel("v0.0.1"), "v0.0.2");
  assert.equal(nextAppVersionLabel("v0.0.9"), "v0.0.10");
  assert.equal(nextAppVersionLabel("bad-value"), "v0.0.1");
});
