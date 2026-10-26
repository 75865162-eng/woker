import test from "node:test";
import assert from "node:assert/strict";
import { sellfoxBrowseQuery, sellfoxBrand, sellfoxBuyBox, sellfoxSnapshotWhere, sellfoxRunWhere, sellfoxHourlyWhere } from "@/lib/sellfox/browse-query";
import { readSellfoxView, sellfoxViewParams, sellfoxSortPatch, sellfoxAdsResource } from "@/lib/sellfox/workbench-view";
import { sellfoxPayloadPreview } from "@/lib/sellfox/payload-preview";

const query = (params: string) => sellfoxBrowseQuery(new URL(`http://localhost/?${params}`));
test("browse query validates real dates and integer pagination without truncating historical ranges", () => {
  for (const params of ["from=2026-02-29", "from=2026-10-25&to=2026-10-24", "page=1.5", "page=Infinity", "pageSize=201"]) assert.throws(() => query(params));
  assert.equal(query("from=2020-01-01&to=2026-10-24").from, "2020-01-01");
  assert.deepEqual(query("shopExternalId=a&shopExternalId=a&shopExternalId=b").shopExternalIds, ["a", "b"]);
});
test("snapshots and hourly filters preserve tenant, site, date and supported search", () => {
  const q = query("from=2026-10-01&to=2026-10-24&site=US&search=SKU");
  const where = sellfoxSnapshotWhere(q, "org", "workspace", ["store"]);
  assert.equal(where.organizationId, "org"); assert.equal(where.workspaceId, "workspace");
  assert.deepEqual(where.reportDate, { gte: "2026-10-01", lte: "2026-10-24" });
  assert.deepEqual(where.SellfoxStore, { marketplace: "US" });
  assert.deepEqual(where.storeId, { in: ["store"] });
  assert.match(JSON.stringify(sellfoxHourlyWhere(q, "org", "workspace")), /entityName/);
  assert.equal(sellfoxSnapshotWhere(query("allDates=1"), "org", "workspace", undefined, true).reportDate, undefined);
});
test("run date ranges use inclusive Shanghai calendar dates with an exclusive next-day boundary", () => {
  const where = sellfoxRunWhere(query("from=2026-10-24&to=2026-10-24&search=failed"), "org", "workspace");
  assert.deepEqual(where.startedAt, { gte: new Date("2026-10-23T16:00:00Z"), lt: new Date("2026-10-24T16:00:00Z") });
  assert.equal(where.organizationId, "org"); assert.equal(where.workspaceId, "workspace");
  assert.match(JSON.stringify(where.OR), /status/);
});
test("shareable view parameters round-trip shops, site, history and pagination", () => {
  const view = readSellfoxView(new URLSearchParams("domain=sales&from=2026-10-01&to=2026-10-24&site=US&search=MSKU&shopExternalId=a&shopExternalId=b&page=2&allDates=1"));
  assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
  const runs = sellfoxViewParams({ ...view, domain: "runs" }, true);
  assert.equal(runs.has("shopExternalId"), false); assert.equal(runs.has("site"), false);
});
test("store, developer and sales-only SPU dimensions round trip while unknown values retain safe defaults", () => {
  for (const domain of ["sales", "performance"]) {
    for (const dimension of ["store", "developer", ...(domain === "sales" ? ["spu"] : [])]) {
      const view = readSellfoxView(new URLSearchParams(`domain=${domain}&dimension=${dimension}`));
      assert.equal(view.dimension, dimension);
      assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
      assert.equal(query(sellfoxViewParams(view, true).toString()).dimension, dimension);
    }
  }
  for (const dimension of ["", "payload", "storeId", 'store";DROP TABLE', "salesperson"]) {
    const params = new URLSearchParams({ dimension });
    assert.equal(readSellfoxView(params).dimension, "asin");
    assert.equal(query(params.toString()).dimension, "msku");
  }
});
test("raw details redact nested credentials and bound large or deep payloads", () => {
  const preview = sellfoxPayloadPreview({ token: "private", rows: [{ client_secret: "hidden", link: "https://example.test/?access_token=private&sign=private", msku: "sku-a" }], large: "x".repeat(3000) });
  const output = JSON.stringify(preview.payload);
  assert.doesNotMatch(output, /private|hidden/); assert.match(output, /sku-a/); assert.equal(preview.truncated, true);
  assert.equal(sellfoxPayloadPreview(Array.from({ length: 1000 }, () => ({ a: "x" }))).truncated, true);
});


test("legacy profit queries explicitly isolate all-orders and settled partitions", () => {
  assert.equal(sellfoxSnapshotWhere(query(""), "org", "ws", undefined, true).onlySettle, false);
  assert.equal(sellfoxSnapshotWhere(query("onlySettle=1"), "org", "ws", undefined, true).onlySettle, true);
  assert.equal(sellfoxSnapshotWhere(query("onlySettle=1"), "org", "ws").onlySettle, undefined);
});

test("fulfillment accepts only AFN/MFN and round trips UI, API and export parameters", () => {
  for (const fulfillment of ["AFN", "MFN"] as const) {
    assert.equal(query(`fulfillment=${fulfillment}`).fulfillment, fulfillment);
    for (const domain of ["sales", "performance", "listings"]) {
      const view = readSellfoxView(new URLSearchParams({ domain, fulfillment }));
      assert.equal(readSellfoxView(sellfoxViewParams(view)).fulfillment, fulfillment);
      assert.equal(query(sellfoxViewParams(view, true).toString()).fulfillment, fulfillment);
    }
  }
  for (const value of ["", "afn", "FBA", "UNKNOWN", "AFN' OR TRUE--"]) {
    assert.equal(query(`fulfillment=${encodeURIComponent(value)}`).fulfillment, "");
    const view = readSellfoxView(new URLSearchParams({ domain: "sales", fulfillment: value }));
    assert.equal(view.fulfillment, "");
    assert.equal(sellfoxViewParams(view, true).has("fulfillment"), false);
  }
  for (const adsTab of ["product", "targeting", "searchTerm", "campaign", "adGroup", "placement"]) {
    for (const fulfillment of ["", "AFN", "MFN"]) {
      const view = readSellfoxView(new URLSearchParams({ domain: "ads", adsTab, fulfillment }));
      assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
      const params = sellfoxViewParams(view, true);
      assert.equal(sellfoxBrowseQuery(new URL(`http://localhost/?${params}`), sellfoxAdsResource(view)).fulfillment, fulfillment);
      assert.equal(params.has("fulfillment"), Boolean(fulfillment));
    }
  }
});


test("Buy Box accepts only yes/no and round trips URLs, requests and domain switches like fulfillment", () => {
  for (const buyBox of ["", "yes", "no"] as const) {
    assert.equal(sellfoxBuyBox(buyBox), buyBox);
    assert.equal(query(new URLSearchParams({ buyBox }).toString()).buyBox, buyBox);
    for (const domain of ["sales", "performance", "listings"]) {
      const view = readSellfoxView(new URLSearchParams({ domain, buyBox }));
      assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
      assert.equal(query(sellfoxViewParams(view, true).toString()).buyBox, buyBox);
      const switched = { ...view, domain: "ads" as const };
      assert.equal(query(sellfoxViewParams(switched, true).toString()).buyBox, buyBox);
      for (const adsTab of ["product", "targeting", "searchTerm", "campaign", "adGroup", "placement"] as const) {
        const adsView = { ...switched, adsTab };
        assert.deepEqual(readSellfoxView(sellfoxViewParams(adsView)), adsView);
        assert.equal(query(sellfoxViewParams(adsView, true).toString()).buyBox, buyBox);
      }
      const restored = { ...readSellfoxView(sellfoxViewParams(switched)), domain: view.domain };
      assert.equal(query(sellfoxViewParams(restored, true).toString()).buyBox, buyBox);
      assert.equal(sellfoxViewParams({ ...view, buyBox: "" }).has("buyBox"), false);
    }
  }
  for (const value of [null, undefined, "true", "false", "YES", " no ", "yes' OR TRUE--"]) {
    assert.equal(sellfoxBuyBox(value), "");
    const params = new URLSearchParams(value == null ? {} : { buyBox: value });
    assert.equal(query(params.toString()).buyBox, "");
    const view = readSellfoxView(params);
    assert.equal(view.buyBox, "");
    assert.equal(sellfoxViewParams(view, true).has("buyBox"), false);
  }
});

test("productTag trims arbitrary exact names and round trips UI, browse and export parameters", () => {
  for (const tag of ["1年以内产品", "1-3年产品", "3年以上老品", "6个月以内", "新标签、含分隔符", "%' OR TRUE--"]) {
    for (const domain of ["listings", "sales", "performance"]) {
      const view = readSellfoxView(new URLSearchParams({ domain, productTag: `  ${tag}  ` }));
      assert.equal(view.productTag, tag);
      assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
      assert.equal(query(sellfoxViewParams(view, true).toString()).productTag, tag);
    }
  }
  for (const productTag of ["", "   ", "\t\n"]) {
    assert.equal(query(new URLSearchParams({ productTag }).toString()).productTag, "");
    const view = readSellfoxView(new URLSearchParams({ domain: "listings", productTag }));
    assert.equal(view.productTag, ""); assert.equal(sellfoxViewParams(view).has("productTag"), false);
  }
  for (const adsTab of ["product", "targeting", "searchTerm", "campaign", "adGroup", "placement"]) {
    for (const tag of ["标签", "标签、完整", "%' OR TRUE--"]) {
      const ads = readSellfoxView(new URLSearchParams({ domain: "ads", adsTab, productTag: ` ${tag} `, brand: "ignored", fulfillment: "AFN", buyBox: "yes", salesperson: "ignored" }));
      assert.deepEqual(readSellfoxView(sellfoxViewParams(ads)), ads);
      const params = sellfoxViewParams(ads, true);
      assert.equal(params.get("productTag"), tag); assert.equal(params.get("layout"), "workbench");
      assert.equal(sellfoxBrowseQuery(new URL(`http://localhost/?${params}`), sellfoxAdsResource(ads)).productTag, tag);
      assert.equal(params.get("fulfillment"), "AFN");
      assert.equal(params.get("brand"), "ignored");
      assert.equal(params.get("buyBox"), "yes");
      assert.equal(params.has("salesperson"), false);
    }
  }
});

test("brand trims arbitrary exact names and round trips UI, browse and export parameters", () => {
  for (const brand of ["00123", "Goghost-乐器", "Archerest-weinijia", "Nvaav", "B".repeat(512), "品牌、完整", "%' OR TRUE--"]) {
    for (const domain of ["listings", "sales", "performance", "ads"]) {
      const view = readSellfoxView(new URLSearchParams({ domain, brand: `  ${brand}  ` }));
      assert.equal(view.brand, brand);
      assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
      assert.equal(query(sellfoxViewParams(view, true).toString()).brand, brand);
    }
  }
  for (const brand of ["", "   ", "\t\n"]) {
    assert.equal(query(new URLSearchParams({ brand }).toString()).brand, "");
    const view = readSellfoxView(new URLSearchParams({ domain: "listings", brand }));
    assert.equal(view.brand, ""); assert.equal(sellfoxViewParams(view).has("brand"), false);
  }
  for (const adsTab of ["product", "targeting", "searchTerm", "campaign", "adGroup", "placement"]) {
    const ads = readSellfoxView(new URLSearchParams({ domain: "ads", adsTab, brand: " 00123 " }));
    assert.deepEqual(readSellfoxView(sellfoxViewParams(ads)), ads);
    const params = sellfoxViewParams(ads, true);
    assert.equal(params.get("brand"), "00123");
    assert.equal(sellfoxBrowseQuery(new URL(`http://localhost/?${params}`), sellfoxAdsResource(ads)).brand, "00123");
  }
});

test("sellfoxBrand trims without a length cap or whitelist", () => {
  for (const value of [null, undefined, "", " ", "\t\n"]) assert.equal(sellfoxBrand(value), "");
  assert.equal(sellfoxBrand("  Goghost-乐器  "), "Goghost-乐器");
  assert.equal(sellfoxBrand("B".repeat(512)).length, 512);
});

test("sort parameters round trip URL, browse and export requests without losing filters", () => {
  const view = readSellfoxView(new URLSearchParams("domain=sales&sortBy=subtotal&sortOrder=desc&page=3&site=US&shopExternalId=a&search=SKU&metric=orders"));
  assert.equal(view.sortBy, "subtotal"); assert.equal(view.sortOrder, "desc");
  assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
  const request = sellfoxBrowseQuery(new URL(`http://localhost/?${sellfoxViewParams(view, true)}`), "sales");
  assert.equal(request.sortBy, "subtotal"); assert.equal(request.sortOrder, "desc");
  assert.equal(request.page, 3); assert.equal(request.site, "US"); assert.equal(request.search, "SKU");
  assert.deepEqual(request.shopExternalIds, ["a"]); assert.equal(request.metric, "orders");
});

test("sort rejects unknown, cross-domain, prototype and injection keys and invalid directions", () => {
  for (const params of ["sortBy=payload", "sortBy=__proto__", "sortBy=constructor", "sortBy=image", "sortBy=day:2026-10-24", "sortBy=cost;DROP TABLE", "sortBy=cost&sortOrder=DESC", "sortBy=", "sortOrder=desc"]) assert.throws(() => query(params));
  assert.throws(() => sellfoxBrowseQuery(new URL("http://localhost/?sortBy=cost"), "stores"));
  assert.throws(() => sellfoxBrowseQuery(new URL("http://localhost/?sortBy=adGroupId"), "ads_campaign"));
  assert.equal(sellfoxBrowseQuery(new URL("http://localhost/?sortBy=cost"), "ads_report").sortOrder, "asc");
  assert.equal(query("").sortBy, "");
  assert.equal(readSellfoxView(new URLSearchParams("domain=stores&sortBy=cost")).sortBy, "");
});

test("ads current Listing rating, review count, tags, brand, fulfillment and Buy Box sort across tabs; images remain unsortable", () => {
  for (const [tab, domain] of [["product", "ads_report"], ["targeting", "ads_targeting"], ["searchTerm", "ads_search_term"], ["campaign", "ads_campaign"], ["adGroup", "ads_ad_group"], ["placement", "ads_placement"]]) {
    for (const sortBy of ["rating", "ratingCount", "productTags", "brand", "fulfillment", "buyBoxWinner"]) {
      const view = readSellfoxView(new URLSearchParams({ domain: "ads", adsTab: tab, sortBy, sortOrder: "desc" }));
      assert.equal(readSellfoxView(sellfoxViewParams(view)).sortBy, sortBy);
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${sellfoxViewParams(view, true)}`), domain);
      assert.equal(query.sortBy, sortBy); assert.equal(query.sortOrder, "desc");
    }
    assert.throws(() => sellfoxBrowseQuery(new URL("http://localhost/?sortBy=image"), domain));
  }
});


test("header sort toggles asc/desc, resets pagination and starts new columns ascending", () => {
  const view = readSellfoxView(new URLSearchParams("domain=sales&page=4&site=US"));
  const asc = { ...view, ...sellfoxSortPatch(view, "subtotal") };
  assert.equal(asc.page, 1); assert.equal(asc.sortOrder, "asc"); assert.equal(asc.site, "US");
  const desc = { ...asc, ...sellfoxSortPatch(asc, "subtotal") };
  assert.equal(desc.sortOrder, "desc");
  assert.equal(sellfoxSortPatch(desc, "subtotal").sortOrder, "asc");
  assert.equal(sellfoxSortPatch(desc, "identity").sortOrder, "asc");
});


test("salesperson trims exact names and round trips browse, UI and export for performance only", () => {
  const view = readSellfoxView(new URLSearchParams({ domain: "performance", salesperson: " 温见清 " }));
  assert.equal(view.salesperson, "温见清");
  assert.equal(readSellfoxView(sellfoxViewParams(view)).salesperson, "温见清");
  assert.equal(query(sellfoxViewParams(view, true).toString()).salesperson, "温见清");
  for (const salesperson of ["", "  ", "\t\n"]) {
    assert.equal(query(new URLSearchParams({ salesperson }).toString()).salesperson, "");
    assert.equal(sellfoxViewParams(readSellfoxView(new URLSearchParams({ domain: "performance", salesperson }))).has("salesperson"), false);
  }
  for (const domain of ["sales", "listings", "ads"] as const) assert.equal(sellfoxViewParams({ ...view, domain }, true).has("salesperson"), false);
});

test("performance extra fee selections and sorting round trip without Listing aliases", () => {
  const keys = ["headTripPrice", "avgPurchaseCost", "amazonCommissionPrice", "evaluationSaleNum", "channelSaleNum", "adSpCost", "adSdCost", "adSbCost", "adSbvCost", "adSbsCost", "fbaStorageFeeAmount", "fbaLongTermStorageFeeAmount", "fbaRemovalFeeAmount", "fbaDisposalFeeAmount", "customAsinFee", "customShopFee", "serviceFeeAmount", "storageFeeAmount", "compensationAmount", "evaluationFee", "promotionTotalAmount", "fbaOverageFeeAmount", "chargebackAmount", "guaranteeClaimAmount", "digitalServicesFeeAmount", "otherPriceAmount", "shippingChargeAmount", "regulatoryFeeAmount", "couponPaymentAmount", "sellerDealPaymentAmount", "vineFeeAmount", "starStorageFeeAmount", "subscriptionAmount", "fbaCustomerReturnAmount", "fbaInboundConvenienceFeeAmount", "inboundTransportationFeeAmount", "shippingChargebackAmount", "giftwrapChargebackAmount", "costOfPointsGrantedAmount", "orderOtherPriceAmount", "fbaInboundTransportationProgramFee", "aglFeeAmount", "paidServicesFeeAmount", "customerReturnHrrUnitFeeAmount", "amazonUpstreamStorageTransportationFeeAmount", "amazonUpstreamProcessingFeeAmount", "mfnPostageFeeAmount", "adjustmentFeeAmount", "otherServiceFeeAmount", "avgHeadTripPrice", "purchaseRefundPrice", "revenueAmount", "fbaPerUnitFulfillmentFeeRefundAmount", "fbaWeightBasedFeeRefundAmount", "deferredAmount", "withheldTaxAmount", "otherPriceIncomeAmount", "paymentMethodFeeAmount", "fixedClosingFeeAmount", "variableClosingFeeAmount", "imagingServicesFeeAmount", "netCoAmount", "comminglingVatAmount", "codFeeAmount", "evaluationCapital", "evaluationCommission", "dealPerformanceFeeAmount", "couponParticipationFeeAmount", "safetReimbursedAmount", "affordabilityExpenseAmount", "withheldFeeAmount", "chargebackIncomeAmount", "guaranteeClaimIncomeAmount", "promotionSalesAmount", "promotionShippingAmount", "promotionTaxAmount"];
  for (const key of keys) {
    const params = new URLSearchParams({ domain: "performance", sortBy: key, sortOrder: "desc" });
    const view = readSellfoxView(params);
    assert.equal(view.sortBy, key);
    const exported = sellfoxViewParams(view, true);
    // The workbench adds the selected columns to its export URL separately from view state.
    keys.forEach(key => exported.append("column", key));
    assert.deepEqual(new URL(`http://localhost/?${exported}`).searchParams.getAll("column"), keys);
    const parsed = sellfoxBrowseQuery(new URL(`http://localhost/?${exported}`), "performance");
    assert.equal(parsed.sortBy, key);
  }
});

test("sales catalog sort keys round trip UI, browse and export; trend sorting stays unavailable", () => {
  for (const key of ["brand", "productTags", "price"]) {
    const view = readSellfoxView(new URLSearchParams(`domain=sales&sortBy=${key}&sortOrder=desc&page=2`));
    assert.equal(view.sortBy, key);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    assert.equal(sellfoxBrowseQuery(new URL(`http://localhost/?${sellfoxViewParams(view, true)}`), "sales").sortBy, key);
  }
  for (const key of ["trend", "average7", "salesperson", "sales7"]) assert.throws(() => sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}`), "sales"));
});

test("DXM publish state trims arbitrary exact values and round trips listings without leaking into other domain requests", () => {
  for (const dxmPublishState of ["delete", "future-state", "00123", "原值、完整", "S".repeat(512), "%' OR TRUE--"]) {
    const view = readSellfoxView(new URLSearchParams({ domain: "listings", dxmPublishState: `  ${dxmPublishState}  ` }));
    assert.equal(view.dxmPublishState, dxmPublishState);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    assert.equal(query(sellfoxViewParams(view, true).toString()).dxmPublishState, dxmPublishState);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("dxmPublishState"), dxmPublishState);
      assert.equal(sellfoxViewParams(other, true).has("dxmPublishState"), false);
    }
  }
  for (const dxmPublishState of ["", "   ", "\t\n"]) {
    assert.equal(query(new URLSearchParams({ dxmPublishState }).toString()).dxmPublishState, "");
    const view = readSellfoxView(new URLSearchParams({ domain: "listings", dxmPublishState }));
    assert.equal(view.dxmPublishState, "");
    for (const forRequest of [false, true]) {
      assert.equal(sellfoxViewParams(view, forRequest).has("dxmPublishState"), false);
      assert.equal(sellfoxViewParams({ ...view, dxmPublishState }, forRequest).has("dxmPublishState"), false);
    }
  }
  assert.equal(query("").dxmPublishState, "");
});

test("bsrCategory trims arbitrary exact values and round trips listings without leaking into other domain requests", () => {
  for (const bsrCategory of ["Baby", "Musical Instruments", "00123", "原值、完整", "S".repeat(512), "%' OR TRUE--"]) {
    const view = readSellfoxView(new URLSearchParams({ domain: "listings", bsrCategory: `  ${bsrCategory}  ` }));
    assert.equal(view.bsrCategory, bsrCategory);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    assert.equal(query(sellfoxViewParams(view, true).toString()).bsrCategory, bsrCategory);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("bsrCategory"), bsrCategory);
      assert.equal(sellfoxViewParams(other, true).has("bsrCategory"), false);
    }
  }
  for (const bsrCategory of ["", "   ", "\t\n"]) {
    assert.equal(query(new URLSearchParams({ bsrCategory }).toString()).bsrCategory, "");
    const view = readSellfoxView(new URLSearchParams({ domain: "listings", bsrCategory }));
    assert.equal(view.bsrCategory, "");
    for (const forRequest of [false, true]) {
      assert.equal(sellfoxViewParams(view, forRequest).has("bsrCategory"), false);
      assert.equal(sellfoxViewParams({ ...view, bsrCategory }, forRequest).has("bsrCategory"), false);
    }
  }
  assert.equal(query("").bsrCategory, "");
});

test("firstSale dates validate and round trip independently of openDate, with listings-only requests", () => {
  for (const range of ["", "firstSaleFrom=2024-02-01", "firstSaleTo=2024-03-01", "firstSaleFrom=2024-02-01&firstSaleTo=2024-03-01", "firstSaleFrom=2024-02-29&firstSaleTo=2024-02-29"]) {
    const params = new URLSearchParams(`domain=listings&from=2023-01-01&to=2023-12-31&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.firstSaleFrom, params.get("firstSaleFrom") || undefined);
    assert.equal(parsed.firstSaleTo, params.get("firstSaleTo") || undefined);
    assert.equal(parsed.from, "2023-01-01"); assert.equal(parsed.to, "2023-12-31");
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("firstSaleFrom"), params.get("firstSaleFrom"));
      assert.equal(sellfoxViewParams(other).get("firstSaleTo"), params.get("firstSaleTo"));
      assert.equal(sellfoxViewParams(other, true).has("firstSaleFrom"), false);
      assert.equal(sellfoxViewParams(other, true).has("firstSaleTo"), false);
    }
  }
  for (const key of ["firstSaleFrom", "firstSaleTo"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["2026-02-29", "2024-13-01", "2024-01-32", "2024-1-01", "invalid", "2024-01-01' OR TRUE--"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /日期必须使用有效 YYYY-MM-DD 格式/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("firstSaleFrom=%202024-02-01%20").firstSaleFrom, "2024-02-01");
  assert.throws(() => query("firstSaleFrom=2024-03-01&firstSaleTo=2024-02-01"), /结束日期不得早于开始日期/);
  assert.throws(() => query("from=2024-03-01&to=2024-02-01&firstSaleFrom=2024-01-01"), /结束日期不得早于开始日期/);
});

test("totalInventory min/max validate as safe integers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "totalInventoryMin=0", "totalInventoryMax=100", "totalInventoryMin=0&totalInventoryMax=100", "totalInventoryMin=-1&totalInventoryMax=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.totalInventoryMin, params.has("totalInventoryMin") ? Number(params.get("totalInventoryMin")) : undefined);
    assert.equal(parsed.totalInventoryMax, params.has("totalInventoryMax") ? Number(params.get("totalInventoryMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("totalInventoryMin"), params.get("totalInventoryMin"));
      assert.equal(sellfoxViewParams(other).get("totalInventoryMax"), params.get("totalInventoryMax"));
      assert.equal(sellfoxViewParams(other, true).has("totalInventoryMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("totalInventoryMax"), false);
    }
  }
  for (const key of ["totalInventoryMin", "totalInventoryMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1.5", "1e2", "NaN", "abc", "01.0", "9007199254740992"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是整数/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("totalInventoryMin=%200%20").totalInventoryMin, 0);
  assert.equal(query("totalInventoryMax=0").totalInventoryMax, 0);
  assert.throws(() => query("totalInventoryMin=10&totalInventoryMax=1"), /总库存上限不得小于下限/);
});

test("rating min/max validate as finite numbers, round trip ads-only forRequest, reject inverted range", () => {
  for (const range of ["", "ratingMin=0", "ratingMax=5", "ratingMin=4.5&ratingMax=5", "ratingMin=0&ratingMax=0", "ratingMin=0.5&ratingMax=4.5"]) {
    const params = new URLSearchParams(`domain=ads&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.ratingMin, params.has("ratingMin") ? Number(params.get("ratingMin")) : undefined);
    assert.equal(parsed.ratingMax, params.has("ratingMax") ? Number(params.get("ratingMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "listings", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("ratingMin"), params.get("ratingMin"));
      assert.equal(sellfoxViewParams(other).get("ratingMax"), params.get("ratingMax"));
      assert.equal(sellfoxViewParams(other, true).has("ratingMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("ratingMax"), false);
    }
  }
  for (const key of ["ratingMin", "ratingMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1e2", "NaN", "abc", "4.5.1", "--1", "Infinity"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是数字/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("ratingMin=%204.5%20").ratingMin, 4.5);
  assert.equal(query("ratingMax=0").ratingMax, 0);
  assert.equal(query("ratingMin=.5").ratingMin, 0.5);
  assert.throws(() => query("ratingMin=5&ratingMax=4"), /星级上限不得小于下限/);
});

test("cost min/max validate as finite numbers, round trip ads-only forRequest, reject inverted range", () => {
  for (const range of ["", "costMin=0", "costMax=100", "costMin=1.5&costMax=48", "costMin=0&costMax=0", "costMin=0.5&costMax=100"]) {
    const params = new URLSearchParams(`domain=ads&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.costMin, params.has("costMin") ? Number(params.get("costMin")) : undefined);
    assert.equal(parsed.costMax, params.has("costMax") ? Number(params.get("costMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "listings", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("costMin"), params.get("costMin"));
      assert.equal(sellfoxViewParams(other).get("costMax"), params.get("costMax"));
      assert.equal(sellfoxViewParams(other, true).has("costMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("costMax"), false);
    }
  }
  for (const key of ["costMin", "costMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1e2", "NaN", "abc", "4.5.1", "--1", "Infinity"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是数字/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("costMin=%201.5%20").costMin, 1.5);
  assert.equal(query("costMax=0").costMax, 0);
  assert.equal(query("costMin=.5").costMin, 0.5);
  assert.throws(() => query("costMin=10&costMax=1"), /花费上限不得小于下限/);
});

test("adSales min/max validate as finite numbers, round trip ads-only forRequest, reject inverted range", () => {
  for (const range of ["", "adSalesMin=0", "adSalesMax=100", "adSalesMin=1.5&adSalesMax=48", "adSalesMin=0&adSalesMax=0", "adSalesMin=0.5&adSalesMax=100"]) {
    const params = new URLSearchParams(`domain=ads&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.adSalesMin, params.has("adSalesMin") ? Number(params.get("adSalesMin")) : undefined);
    assert.equal(parsed.adSalesMax, params.has("adSalesMax") ? Number(params.get("adSalesMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "listings", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("adSalesMin"), params.get("adSalesMin"));
      assert.equal(sellfoxViewParams(other).get("adSalesMax"), params.get("adSalesMax"));
      assert.equal(sellfoxViewParams(other, true).has("adSalesMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("adSalesMax"), false);
    }
  }
  for (const key of ["adSalesMin", "adSalesMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1e2", "NaN", "abc", "4.5.1", "--1", "Infinity"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是数字/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("adSalesMin=%201.5%20").adSalesMin, 1.5);
  assert.equal(query("adSalesMax=0").adSalesMax, 0);
  assert.equal(query("adSalesMin=.5").adSalesMin, 0.5);
  assert.throws(() => query("adSalesMin=10&adSalesMax=1"), /广告销售额上限不得小于下限/);
});

test("ratingCount min/max validate as safe integers, round trip ads-only forRequest, reject inverted range", () => {
  for (const range of ["", "ratingCountMin=0", "ratingCountMax=100", "ratingCountMin=0&ratingCountMax=100", "ratingCountMin=-1&ratingCountMax=0"]) {
    const params = new URLSearchParams(`domain=ads&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.ratingCountMin, params.has("ratingCountMin") ? Number(params.get("ratingCountMin")) : undefined);
    assert.equal(parsed.ratingCountMax, params.has("ratingCountMax") ? Number(params.get("ratingCountMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "listings", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("ratingCountMin"), params.get("ratingCountMin"));
      assert.equal(sellfoxViewParams(other).get("ratingCountMax"), params.get("ratingCountMax"));
      assert.equal(sellfoxViewParams(other, true).has("ratingCountMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("ratingCountMax"), false);
    }
  }
  for (const key of ["ratingCountMin", "ratingCountMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1.5", "1e2", "NaN", "abc", "01.0", "9007199254740992"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是整数/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("ratingCountMin=%200%20").ratingCountMin, 0);
  assert.equal(query("ratingCountMax=0").ratingCountMax, 0);
  assert.throws(() => query("ratingCountMin=10&ratingCountMax=1"), /评论数上限不得小于下限/);
});

test("impressions min/max validate as safe integers, round trip ads-only forRequest, reject inverted range", () => {
  for (const range of ["", "impressionsMin=0", "impressionsMax=100", "impressionsMin=0&impressionsMax=100", "impressionsMin=-1&impressionsMax=0"]) {
    const params = new URLSearchParams(`domain=ads&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.impressionsMin, params.has("impressionsMin") ? Number(params.get("impressionsMin")) : undefined);
    assert.equal(parsed.impressionsMax, params.has("impressionsMax") ? Number(params.get("impressionsMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "listings", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("impressionsMin"), params.get("impressionsMin"));
      assert.equal(sellfoxViewParams(other).get("impressionsMax"), params.get("impressionsMax"));
      assert.equal(sellfoxViewParams(other, true).has("impressionsMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("impressionsMax"), false);
    }
  }
  for (const key of ["impressionsMin", "impressionsMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1.5", "1e2", "NaN", "abc", "01.0", "9007199254740992"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是整数/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("impressionsMin=%200%20").impressionsMin, 0);
  assert.equal(query("impressionsMax=0").impressionsMax, 0);
  assert.throws(() => query("impressionsMin=10&impressionsMax=1"), /曝光上限不得小于下限/);
});

test("clicks min/max validate as safe integers, round trip ads-only forRequest, reject inverted range", () => {
  for (const range of ["", "clicksMin=0", "clicksMax=100", "clicksMin=0&clicksMax=100", "clicksMin=-1&clicksMax=0"]) {
    const params = new URLSearchParams(`domain=ads&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.clicksMin, params.has("clicksMin") ? Number(params.get("clicksMin")) : undefined);
    assert.equal(parsed.clicksMax, params.has("clicksMax") ? Number(params.get("clicksMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "listings", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("clicksMin"), params.get("clicksMin"));
      assert.equal(sellfoxViewParams(other).get("clicksMax"), params.get("clicksMax"));
      assert.equal(sellfoxViewParams(other, true).has("clicksMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("clicksMax"), false);
    }
  }
  for (const key of ["clicksMin", "clicksMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1.5", "1e2", "NaN", "abc", "01.0", "9007199254740992"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是整数/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("clicksMin=%200%20").clicksMin, 0);
  assert.equal(query("clicksMax=0").clicksMax, 0);
  assert.throws(() => query("clicksMin=10&clicksMax=1"), /点击上限不得小于下限/);
});

test("adOrders min/max validate as safe integers, round trip ads-only forRequest, reject inverted range", () => {
  for (const range of ["", "adOrdersMin=0", "adOrdersMax=100", "adOrdersMin=0&adOrdersMax=100", "adOrdersMin=-1&adOrdersMax=0"]) {
    const params = new URLSearchParams(`domain=ads&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.adOrdersMin, params.has("adOrdersMin") ? Number(params.get("adOrdersMin")) : undefined);
    assert.equal(parsed.adOrdersMax, params.has("adOrdersMax") ? Number(params.get("adOrdersMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "listings", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("adOrdersMin"), params.get("adOrdersMin"));
      assert.equal(sellfoxViewParams(other).get("adOrdersMax"), params.get("adOrdersMax"));
      assert.equal(sellfoxViewParams(other, true).has("adOrdersMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("adOrdersMax"), false);
    }
  }
  for (const key of ["adOrdersMin", "adOrdersMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1.5", "1e2", "NaN", "abc", "01.0", "9007199254740992"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是整数/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("adOrdersMin=%200%20").adOrdersMin, 0);
  assert.equal(query("adOrdersMax=0").adOrdersMax, 0);
  assert.throws(() => query("adOrdersMin=10&adOrdersMax=1"), /广告订单上限不得小于下限/);
});

test("bsrRank min/max validate as safe integers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "bsrRankMin=0", "bsrRankMax=10000", "bsrRankMin=1&bsrRankMax=5000", "bsrRankMin=-1&bsrRankMax=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.bsrRankMin, params.has("bsrRankMin") ? Number(params.get("bsrRankMin")) : undefined);
    assert.equal(parsed.bsrRankMax, params.has("bsrRankMax") ? Number(params.get("bsrRankMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("bsrRankMin"), params.get("bsrRankMin"));
      assert.equal(sellfoxViewParams(other).get("bsrRankMax"), params.get("bsrRankMax"));
      assert.equal(sellfoxViewParams(other, true).has("bsrRankMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("bsrRankMax"), false);
    }
  }
  for (const key of ["bsrRankMin", "bsrRankMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1.5", "1e2", "NaN", "abc", "01.0", "9007199254740992"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是整数/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("bsrRankMin=%200%20").bsrRankMin, 0);
  assert.equal(query("bsrRankMax=0").bsrRankMax, 0);
  assert.throws(() => query("bsrRankMin=10&bsrRankMax=1"), /BSR上限不得小于下限/);
});

test("fulfillable min/max validate as safe integers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "fulfillableMin=0", "fulfillableMax=10000", "fulfillableMin=1&fulfillableMax=5000", "fulfillableMin=-1&fulfillableMax=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.fulfillableMin, params.has("fulfillableMin") ? Number(params.get("fulfillableMin")) : undefined);
    assert.equal(parsed.fulfillableMax, params.has("fulfillableMax") ? Number(params.get("fulfillableMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("fulfillableMin"), params.get("fulfillableMin"));
      assert.equal(sellfoxViewParams(other).get("fulfillableMax"), params.get("fulfillableMax"));
      assert.equal(sellfoxViewParams(other, true).has("fulfillableMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("fulfillableMax"), false);
    }
  }
  for (const key of ["fulfillableMin", "fulfillableMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1.5", "1e2", "NaN", "abc", "01.0", "9007199254740992"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是整数/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("fulfillableMin=%200%20").fulfillableMin, 0);
  assert.equal(query("fulfillableMax=0").fulfillableMax, 0);
  assert.throws(() => query("fulfillableMin=10&fulfillableMax=1"), /可售上限不得小于下限/);
});

test("sales7 min/max validate as safe integers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "sales7Min=0", "sales7Max=10000", "sales7Min=1&sales7Max=5000", "sales7Min=-1&sales7Max=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.sales7Min, params.has("sales7Min") ? Number(params.get("sales7Min")) : undefined);
    assert.equal(parsed.sales7Max, params.has("sales7Max") ? Number(params.get("sales7Max")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("sales7Min"), params.get("sales7Min"));
      assert.equal(sellfoxViewParams(other).get("sales7Max"), params.get("sales7Max"));
      assert.equal(sellfoxViewParams(other, true).has("sales7Min"), false);
      assert.equal(sellfoxViewParams(other, true).has("sales7Max"), false);
    }
  }
  for (const key of ["sales7Min", "sales7Max"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1.5", "1e2", "NaN", "abc", "01.0", "9007199254740992"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是整数/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("sales7Min=%200%20").sales7Min, 0);
  assert.equal(query("sales7Max=0").sales7Max, 0);
  assert.throws(() => query("sales7Min=10&sales7Max=1"), /7天销量上限不得小于下限/);
});

test("sales14 min/max validate as safe integers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "sales14Min=0", "sales14Max=10000", "sales14Min=1&sales14Max=5000", "sales14Min=-1&sales14Max=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.sales14Min, params.has("sales14Min") ? Number(params.get("sales14Min")) : undefined);
    assert.equal(parsed.sales14Max, params.has("sales14Max") ? Number(params.get("sales14Max")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("sales14Min"), params.get("sales14Min"));
      assert.equal(sellfoxViewParams(other).get("sales14Max"), params.get("sales14Max"));
      assert.equal(sellfoxViewParams(other, true).has("sales14Min"), false);
      assert.equal(sellfoxViewParams(other, true).has("sales14Max"), false);
    }
  }
  for (const key of ["sales14Min", "sales14Max"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1.5", "1e2", "NaN", "abc", "01.0", "9007199254740992"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是整数/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("sales14Min=%200%20").sales14Min, 0);
  assert.equal(query("sales14Max=0").sales14Max, 0);
  assert.throws(() => query("sales14Min=10&sales14Max=1"), /14天销量上限不得小于下限/);
});

test("sales30 min/max validate as safe integers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "sales30Min=0", "sales30Max=10000", "sales30Min=1&sales30Max=5000", "sales30Min=-1&sales30Max=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.sales30Min, params.has("sales30Min") ? Number(params.get("sales30Min")) : undefined);
    assert.equal(parsed.sales30Max, params.has("sales30Max") ? Number(params.get("sales30Max")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("sales30Min"), params.get("sales30Min"));
      assert.equal(sellfoxViewParams(other).get("sales30Max"), params.get("sales30Max"));
      assert.equal(sellfoxViewParams(other, true).has("sales30Min"), false);
      assert.equal(sellfoxViewParams(other, true).has("sales30Max"), false);
    }
  }
  for (const key of ["sales30Min", "sales30Max"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1.5", "1e2", "NaN", "abc", "01.0", "9007199254740992"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是整数/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("sales30Min=%200%20").sales30Min, 0);
  assert.equal(query("sales30Max=0").sales30Max, 0);
  assert.throws(() => query("sales30Min=10&sales30Max=1"), /30天销量上限不得小于下限/);
});

test("listingQuantity min/max validate as finite numbers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "listingQuantityMin=0", "listingQuantityMax=100", "listingQuantityMin=1.5&listingQuantityMax=48", "listingQuantityMin=0&listingQuantityMax=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.listingQuantityMin, params.has("listingQuantityMin") ? Number(params.get("listingQuantityMin")) : undefined);
    assert.equal(parsed.listingQuantityMax, params.has("listingQuantityMax") ? Number(params.get("listingQuantityMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("listingQuantityMin"), params.get("listingQuantityMin"));
      assert.equal(sellfoxViewParams(other).get("listingQuantityMax"), params.get("listingQuantityMax"));
      assert.equal(sellfoxViewParams(other, true).has("listingQuantityMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("listingQuantityMax"), false);
    }
  }
  for (const key of ["listingQuantityMin", "listingQuantityMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1e2", "NaN", "abc", "4.5.1", "--1", "Infinity"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是数字/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("listingQuantityMin=%201.5%20").listingQuantityMin, 1.5);
  assert.equal(query("listingQuantityMax=0").listingQuantityMax, 0);
  assert.equal(query("listingQuantityMin=.5").listingQuantityMin, 0.5);
  assert.throws(() => query("listingQuantityMin=10&listingQuantityMax=1"), /Listing库存上限不得小于下限/);
});

test("price min/max validate as finite numbers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "priceMin=0", "priceMax=100", "priceMin=1.5&priceMax=48", "priceMin=0&priceMax=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.priceMin, params.has("priceMin") ? Number(params.get("priceMin")) : undefined);
    assert.equal(parsed.priceMax, params.has("priceMax") ? Number(params.get("priceMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("priceMin"), params.get("priceMin"));
      assert.equal(sellfoxViewParams(other).get("priceMax"), params.get("priceMax"));
      assert.equal(sellfoxViewParams(other, true).has("priceMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("priceMax"), false);
    }
  }
  for (const key of ["priceMin", "priceMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1e2", "NaN", "abc", "4.5.1", "--1", "Infinity"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是数字/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("priceMin=%201.5%20").priceMin, 1.5);
  assert.equal(query("priceMax=0").priceMax, 0);
  assert.equal(query("priceMin=.5").priceMin, 0.5);
  assert.throws(() => query("priceMin=10&priceMax=1"), /价格上限不得小于下限/);
});

test("revenue7 min/max validate as finite numbers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "revenue7Min=0", "revenue7Max=100", "revenue7Min=1.5&revenue7Max=48", "revenue7Min=0&revenue7Max=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.revenue7Min, params.has("revenue7Min") ? Number(params.get("revenue7Min")) : undefined);
    assert.equal(parsed.revenue7Max, params.has("revenue7Max") ? Number(params.get("revenue7Max")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("revenue7Min"), params.get("revenue7Min"));
      assert.equal(sellfoxViewParams(other).get("revenue7Max"), params.get("revenue7Max"));
      assert.equal(sellfoxViewParams(other, true).has("revenue7Min"), false);
      assert.equal(sellfoxViewParams(other, true).has("revenue7Max"), false);
    }
  }
  for (const key of ["revenue7Min", "revenue7Max"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1e2", "NaN", "abc", "4.5.1", "--1", "Infinity"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是数字/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("revenue7Min=%201.5%20").revenue7Min, 1.5);
  assert.equal(query("revenue7Max=0").revenue7Max, 0);
  assert.equal(query("revenue7Min=.5").revenue7Min, 0.5);
  assert.throws(() => query("revenue7Min=10&revenue7Max=1"), /7天销售额上限不得小于下限/);
});

test("reservedQty min/max validate as finite numbers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "reservedQtyMin=0", "reservedQtyMax=100", "reservedQtyMin=1.5&reservedQtyMax=48", "reservedQtyMin=0&reservedQtyMax=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.reservedQtyMin, params.has("reservedQtyMin") ? Number(params.get("reservedQtyMin")) : undefined);
    assert.equal(parsed.reservedQtyMax, params.has("reservedQtyMax") ? Number(params.get("reservedQtyMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("reservedQtyMin"), params.get("reservedQtyMin"));
      assert.equal(sellfoxViewParams(other).get("reservedQtyMax"), params.get("reservedQtyMax"));
      assert.equal(sellfoxViewParams(other, true).has("reservedQtyMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("reservedQtyMax"), false);
    }
  }
  for (const key of ["reservedQtyMin", "reservedQtyMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1e2", "NaN", "abc", "4.5.1", "--1", "Infinity"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是数字/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("reservedQtyMin=%201.5%20").reservedQtyMin, 1.5);
  assert.equal(query("reservedQtyMax=0").reservedQtyMax, 0);
  assert.equal(query("reservedQtyMin=.5").reservedQtyMin, 0.5);
  assert.throws(() => query("reservedQtyMin=10&reservedQtyMax=1"), /预留上限不得小于下限/);
});

test("unsellable min/max validate as finite numbers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "unsellableMin=0", "unsellableMax=100", "unsellableMin=1.5&unsellableMax=48", "unsellableMin=0&unsellableMax=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.unsellableMin, params.has("unsellableMin") ? Number(params.get("unsellableMin")) : undefined);
    assert.equal(parsed.unsellableMax, params.has("unsellableMax") ? Number(params.get("unsellableMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("unsellableMin"), params.get("unsellableMin"));
      assert.equal(sellfoxViewParams(other).get("unsellableMax"), params.get("unsellableMax"));
      assert.equal(sellfoxViewParams(other, true).has("unsellableMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("unsellableMax"), false);
    }
  }
  for (const key of ["unsellableMin", "unsellableMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1e2", "NaN", "abc", "4.5.1", "--1", "Infinity"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是数字/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("unsellableMin=%201.5%20").unsellableMin, 1.5);
  assert.equal(query("unsellableMax=0").unsellableMax, 0);
  assert.equal(query("unsellableMin=.5").unsellableMin, 0.5);
  assert.throws(() => query("unsellableMin=10&unsellableMax=1"), /不可售上限不得小于下限/);
});

test("warehousing min/max validate as finite numbers, round trip listings-only, reject inverted range", () => {
  for (const range of ["", "warehousingMin=0", "warehousingMax=100", "warehousingMin=1.5&warehousingMax=48", "warehousingMin=0&warehousingMax=0"]) {
    const params = new URLSearchParams(`domain=listings&${range}`);
    const view = readSellfoxView(params);
    assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
    const parsed = query(sellfoxViewParams(view, true).toString());
    assert.equal(parsed.warehousingMin, params.has("warehousingMin") ? Number(params.get("warehousingMin")) : undefined);
    assert.equal(parsed.warehousingMax, params.has("warehousingMax") ? Number(params.get("warehousingMax")) : undefined);
    for (const domain of ["overview", "stores", "inventory", "sales", "performance", "ads", "runs"] as const) {
      const other = { ...view, domain };
      assert.equal(sellfoxViewParams(other).get("warehousingMin"), params.get("warehousingMin"));
      assert.equal(sellfoxViewParams(other).get("warehousingMax"), params.get("warehousingMax"));
      assert.equal(sellfoxViewParams(other, true).has("warehousingMin"), false);
      assert.equal(sellfoxViewParams(other, true).has("warehousingMax"), false);
    }
  }
  for (const key of ["warehousingMin", "warehousingMax"] as const) {
    for (const value of ["", " ", "\t\n"]) assert.equal(query(new URLSearchParams({ [key]: value }).toString())[key], undefined);
    for (const value of ["1e2", "NaN", "abc", "4.5.1", "--1", "Infinity"]) {
      const params = new URLSearchParams({ [key]: value });
      assert.throws(() => query(params.toString()), /必须是数字/);
      const view = readSellfoxView(params);
      assert.equal(view[key], ""); assert.equal(sellfoxViewParams(view).has(key), false);
    }
  }
  assert.equal(query("warehousingMin=%201.5%20").warehousingMin, 1.5);
  assert.equal(query("warehousingMax=0").warehousingMax, 0);
  assert.equal(query("warehousingMin=.5").warehousingMin, 0.5);
  assert.throws(() => query("warehousingMin=10&warehousingMax=1"), /入库中上限不得小于下限/);
});
