import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { readSellfoxWorkbench, workbenchDateRange, workbenchReadSql } from "@/lib/sellfox/workbench-read";
import { backfillSellfoxViewDates, defaultSellfoxView, readSellfoxView, sellfoxViewParams } from "@/lib/sellfox/workbench-view";
import { browseEmptyMessage, visibleColumns, visibleColumnCsv, sellfoxColumnValue } from "@/components/sellfox/workbench-types";

test("workbench matrix URL round trips independent dimensions, metric, zero filter and ad filters", () => {
  const input = { ...defaultSellfoxView, domain: "sales" as const, dimension: "parentAsin", metric: "revenue", hideZero: true, shops: ["s1"], from: "2026-10-01", to: "2026-10-07" };
  const params = sellfoxViewParams(input, true), query = sellfoxBrowseQuery(new URL(`http://localhost/?${params}`));
  assert.equal(query.dimension, "parentAsin"); assert.equal(query.metric, "revenue"); assert.equal(query.hideZero, true); assert.equal(query.layout, true);
  const view = readSellfoxView(sellfoxViewParams(input)); assert.equal(view.dimension, input.dimension); assert.equal(view.hideZero, true);
  const adsParams = sellfoxViewParams({ ...input, domain: "ads", currency: "USD" }, true);
  assert.equal(adsParams.has("currency"), false); // Profit-only currency must not hide currency-less ads.
  const unsafe = sellfoxBrowseQuery(new URL('http://localhost/?dimension=payload&metric=orderNum&adType=unknown&quickFilter=paused'));
  assert.equal(unsafe.dimension, "msku"); assert.equal(unsafe.metric, "quantity"); assert.equal(unsafe.adType, ""); assert.equal(unsafe.quickFilter, "");
});
test("sales and performance currency round trip through view and browse requests", () => {
  for (const domain of ["sales", "performance"] as const) {
    const view = readSellfoxView(new URLSearchParams(`domain=${domain}&currency=CAD`));
    assert.equal(readSellfoxView(sellfoxViewParams(view)).currency, "CAD");
    const params = sellfoxViewParams(view, true);
    assert.equal(params.get("currency"), "CAD");
    const query = sellfoxBrowseQuery(new URL(`http://localhost/?${params}`));
    assert.equal(query.currency, "CAD");
    const sql = workbenchReadSql(domain, query, { organizationId: "org", workspaceId: "ws" });
    assert.match(sql.text, /s\.currency=/);
    assert.ok(sql.values.includes("CAD"));
  }
  for (const suffix of ["", "&currency="]) {
    const sales = readSellfoxView(new URLSearchParams(`domain=sales${suffix}`));
    assert.equal(sales.currency, "");
    const params = sellfoxViewParams(sales, true);
    assert.equal(params.has("currency"), false);
    const query = sellfoxBrowseQuery(new URL(`http://localhost/?${params}`));
    assert.equal(query.currency, "");
    assert.doesNotMatch(workbenchReadSql("sales", query, { organizationId: "org", workspaceId: "ws" }).text, /s\.currency=/);
  }
});
test("matrix enumerates business days including leap day and rejects unbounded/overwide windows", () => {
  assert.deepEqual(workbenchDateRange(sellfoxBrowseQuery(new URL('http://localhost/?from=2024-02-28&to=2024-03-01'))), ["2024-02-28", "2024-02-29", "2024-03-01"]);
  assert.throws(() => workbenchDateRange(sellfoxBrowseQuery(new URL('http://localhost/?from=2026-01-01&to=2026-10-01'))), /90/);
  assert.throws(() => workbenchDateRange(sellfoxBrowseQuery(new URL('http://localhost/?allDates=1'))), /日期范围/);
});
test("fallback dates freeze once and round trip with the same currency, scope filters and page", () => {
  for (const domain of ["sales", "performance"] as const) {
    for (const currency of [undefined, "", "CAD"]) {
      const params = new URLSearchParams({ domain, onlySettle: domain === "performance" ? "1" : "0", page: "2", shopExternalId: "s1" });
      if (currency !== undefined) params.set("currency", currency);
      const view = readSellfoxView(params);
      const resolved = backfillSellfoxViewDates(view, ["2026-10-16", "2026-10-14", "2026-10-15"]);
      assert.deepEqual(resolved, { ...view, from: "2026-10-14", to: "2026-10-16" });
      assert.equal(view.from, "");
      assert.equal(backfillSellfoxViewDates(resolved, ["2026-10-25"]), resolved);
      const reloaded = readSellfoxView(sellfoxViewParams(resolved));
      assert.deepEqual(reloaded, resolved);
      assert.equal(sellfoxViewParams(reloaded, true).toString(), sellfoxViewParams(resolved, true).toString());
    }
  }
});
test("date backfill never invents dates, changes explicit/open-ended ranges or restricts all history", () => {
  const implicit = { ...defaultSellfoxView, domain: "performance" as const };
  for (const invalid of [undefined, null, [], "2026-10-16", [null], ["2026-02-30"], ["2026-10-16", "invalid"]]) {
    assert.equal(backfillSellfoxViewDates(implicit, invalid), implicit);
  }
  for (const view of [
    { ...implicit, from: "2026-10-01" }, { ...implicit, to: "2026-10-20" },
    { ...implicit, allDates: true }, { ...implicit, domain: "listings" as const },
  ]) assert.equal(backfillSellfoxViewDates(view, ["2026-10-16"]), view);
});
test("UI browse SQL binds scope and search text, filters after entity aggregation, and never reads raw payload", () => {
  const query = sellfoxBrowseQuery(new URL('http://localhost/?from=2026-10-01&to=2026-10-07&search=%27%3BDROP%20TABLE&hideZero=1&dimension=asin'));
  const sql = workbenchReadSql("sales", query, { organizationId: "org-unique", workspaceId: "workspace-unique" });
  assert.ok(sql.values.includes("org-unique")); assert.ok(sql.values.includes("workspace-unique")); assert.ok(sql.values.includes("%';DROP TABLE%"));
  assert.ok(!sql.text.includes("DROP TABLE")); assert.ok(!sql.text.includes("payload"));
  assert.match(sql.text, /bool_and\(complete AND quantity IS NOT NULL\)/);
  assert.match(sql.text, /filtered AS \(SELECT \* FROM grouped WHERE true AND quantity IS DISTINCT FROM 0\)/);
  const ads = workbenchReadSql("ads_report", { ...query, quickFilter: "clicksNoOrders" }, { organizationId: "org", workspaceId: "ws" });
  assert.match(ads.text, /clicks>0 AND "adOrders"=0/);
});
test("visible-column export matches ordered matrix headers, leaves unsupported values blank and escapes formulas", () => {
  const config = visibleColumns("sales", ["identity", "awdAvailable", "subtotal", "day:2026-10-01"], ["2026-10-01"], "asin");
  assert.deepEqual(config.map(c=>c.labelZh), ["ASIN", "小计", "AWD库存", "10-01"]);
  const csv = visibleColumnCsv(config, [{ identity: "=UNTRUSTED()", awdAvailable: 999, subtotal: null, "day:2026-10-01": 0 }]);
  assert.match(csv, /'=UNTRUSTED/); assert.ok(!csv.includes("999")); assert.match(csv, /"","",0$/);
  assert.deepEqual(visibleColumns("performance", []).map(c=>c.key), []);
});


test("typed exact search binds literal input, rejects absent fields and keeps quick filters after aggregation", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/?searchType=asin&exactMatch=1&search=B0%25_&pageSize=20"));
  const sql = workbenchReadSql("sales", query, {organizationId:"o",workspaceId:"w"});
  assert.match(sql.text, /lower\(s.asin\)=lower\(/); assert.ok(sql.values.includes("B0%_")); assert.ok(!sql.values.includes("%B0%_%"));
  assert.match(sql.text, /jsonb_each_text/); assert.match(sql.text, /count\(day.value\)=count\(\*\)/);
  assert.throws(() => workbenchReadSql("sales", {...query,searchType:"campaignId"}, {organizationId:"o",workspaceId:"w"}), /搜索类型/);
  for (const [quickFilter, pattern] of [["spendNoClicks", /cost>0 AND clicks=0/], ["noClicks", /clicks=0/]] as const) assert.match(workbenchReadSql("ads_report", {...query,quickFilter}, {organizationId:"o",workspaceId:"w"}).text, pattern);
  const view = readSellfoxView(new URLSearchParams("domain=sales&searchType=asin&exactMatch=1&pageSize=20"));
  assert.equal(sellfoxViewParams(view,true).get("pageSize"),"20"); assert.equal(sellfoxViewParams(view,true).get("exactMatch"),"1");
});


test("reference columns combine only visible identity fields and export identical cell values", () => {
  assert.equal(readSellfoxView(new URLSearchParams("domain=sales")).dimension, "asin");
  const sales = visibleColumns("sales",undefined,["2026-10-24"],"asin");
  assert.deepEqual(sales.map(c=>c.key),["image","identity","name","analysis","operations","salesInsight","parentAsin","msku","sku","title","fulfillable","subtotal"]);
  const store = sales.find(c=>c.key === "name")!;
  assert.equal(sellfoxColumnValue(store,{name:"店铺",marketplace:"US"}),"店铺\nUS");
  const profit = visibleColumns("performance",undefined,[],"msku").find(c=>c.key === "identity")!;
  assert.equal(profit.labelZh,"标题/MSKU");
  assert.equal(sellfoxColumnValue(profit,{title:"商品",identity:"MSKU-1",payload:{title:"错误来源"}}),"商品\nMSKU-1");
  const csv = visibleColumnCsv([profit],[{title:"商品",identity:"MSKU-1"}]);
  assert.match(csv,/"商品\nMSKU-1"/);
  assert.equal(sellfoxColumnValue(profit,{identity:"MSKU-1"}),"MSKU-1");
  const listing = visibleColumns("listings").find(c=>c.key === "asin")!;
  assert.equal(sellfoxColumnValue(listing,{asin:"ASIN-1",msku:"MSKU-1"}),"ASIN-1\nMSKU-1");
  assert.ok(!visibleColumns("ads").some(c=>["image","msku","title"].includes(c.key)));
});


test("orders and onlySettle round trip through URL, browse and export parameters", () => {
  const sales = readSellfoxView(new URLSearchParams("domain=sales&metric=orders"));
  assert.equal(sellfoxBrowseQuery(new URL(`http://localhost/?${sellfoxViewParams(sales,true)}`)).metric, "orders");
  const view = readSellfoxView(new URLSearchParams("domain=performance&onlySettle=1&currency="));
  assert.equal(view.onlySettle, true);
  const query = sellfoxBrowseQuery(new URL(`http://localhost/?${sellfoxViewParams(view,true)}`));
  assert.equal(query.onlySettle, true); assert.equal(query.currency, "");
  const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" });
  assert.match(sql.text, /s\."onlySettle"=/); assert.ok(sql.values.includes(true));
  const all = workbenchReadSql("performance", {...query,onlySettle:false}, { organizationId: "org", workspaceId: "ws" });
  assert.ok(all.values.includes(false));
});

test("order totals preserve null and image columns use current scoped Listing metadata", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/?metric=orders"));
  const sql = workbenchReadSql("sales", query, { organizationId: "org", workspaceId: "ws" });
  assert.match(sql.text, /bool_and\(complete AND orders IS NOT NULL\)/);
  assert.match(sql.text, /jsonb_object_agg\("reportDate",orders\)/);
  assert.match(sql.text, /count\("orders"\)=count\(\*\)/);
  assert.match(sql.text, /FROM sellfox_listing_current/);
  assert.match(sql.text, /l\."mainImage" AS "listingMainImage"/);
  for (const domain of ["sales", "performance"]) {
    const image = visibleColumns(domain).find(c => c.key === "image")!;
    assert.equal(image.unavailable, undefined);
    assert.equal(sellfoxColumnValue(image, {mainImage: "https://example.test/product.jpg"}), "https://example.test/product.jpg");
    assert.equal(sellfoxColumnValue(image, {}), "");
  }
});

test("performance browse selects and sums elevated fee fields and prefers listing image over payload fallback", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/?from=2026-10-01&to=2026-10-02"));
  const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" });
  assert.match(sql.text, /s\."promotionDiscount",s\."giftWrapFee",s\."imageUrl"/);
  // Both entity aggregation and currency KPI totals must include non-null fees
  // even beside null rows, and yield 0 when every fee in the group is null.
  for (const key of ["promotionDiscount", "giftWrapFee"]) {
    assert.equal(sql.text.split(`COALESCE(sum("${key}"),0)::float AS "${key}"`).length - 1, 2);
    assert.ok(!sql.text.includes(`count("${key}")`));
  }
  // Other unknown metrics still preserve missing-data semantics.
  assert.match(sql.text, /CASE WHEN count\("grossProfit"\)=count\(\*\) THEN sum\("grossProfit"\)::float END/);
  assert.match(sql.text, /COALESCE\(NULLIF\(l\."mainImage",''\),NULLIF\(s\."imageUrl",''\)\)/);
  assert.match(sql.text, /min\(NULLIF\("mainImageCandidate",''\)\) AS "mainImage"/);
  assert.doesNotMatch(sql.text, /count\((?:DISTINCT )?"mainImageCandidate"\)/);
  for (const domain of ["sales", "performance"] as const) {
    const text = workbenchReadSql(domain, query, { organizationId: "org", workspaceId: "ws" }).text;
    assert.match(text, /min\(NULLIF\("mainImage",''\)\) AS "mainImage"/);
    assert.doesNotMatch(text, /count\((?:DISTINCT )?"(?:listingMainImage|mainImage)"\)/);
    if (domain === "sales") assert.match(text, /min\(NULLIF\("listingMainImage",''\)\) AS "mainImage"/);
  }
  assert.doesNotMatch(workbenchReadSql("sales", query, { organizationId: "org", workspaceId: "ws" }).text, /s\."imageUrl"/);
});

test("performance dates survive effective-date resolution, client backfill and explicit ranges", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  let lookups = 0;
  const sqlCalls: Prisma.Sql[] = [];
  globals.prisma = {
    sellfoxProductDailySnapshot: { findFirst: async () => { lookups++; return { reportDate: "2026-10-25" }; } },
    $queryRaw: async (sql: Prisma.Sql) => { sqlCalls.push(sql); return [{ rows: [], total: 0, totals: [] }]; },
  } as unknown as PrismaClient;
  const read = (params = "") => readSellfoxWorkbench("performance", sellfoxBrowseQuery(new URL(`http://localhost/?${params}`)), { organizationId: "org", workspaceId: "ws" });
  try {
    const implicit = await read();
    assert.deepEqual(implicit.dates, ["2026-10-25"]);
    const view = backfillSellfoxViewDates({ ...defaultSellfoxView, domain: "performance" }, implicit.dates);
    assert.equal(view.from, "2026-10-25"); assert.equal(view.to, "2026-10-25");
    assert.deepEqual((await read(sellfoxViewParams(view, true).toString())).dates, implicit.dates);
    assert.deepEqual((await read("reportDate=2026-10-24")).dates, ["2026-10-24"]);
    assert.deepEqual((await read("from=2026-10-23&to=2026-10-25")).dates, ["2026-10-23", "2026-10-24", "2026-10-25"]);
    assert.deepEqual((await read("from=2026-10-23")).dates, ["2026-10-23"]);
    assert.deepEqual((await read("to=2026-10-25")).dates, ["2026-10-25"]);
    assert.equal((await read("from=2026-01-01&to=2026-10-25")).dates.length, 298);
    assert.deepEqual((await read("allDates=1")).dates, []);
    assert.equal(lookups, 1);
    assert.ok(sqlCalls[0].values.includes("2026-10-25"));
    assert.ok(sqlCalls[1].values.includes("2026-10-25"));
  } finally { globals.prisma = previous; }
});

test("performance fee columns are numeric and available; empty browse guidance follows worker and sync status", () => {
  const fees = visibleColumns("performance").filter(column => ["promotionDiscount", "giftWrapFee"].includes(column.key));
  assert.deepEqual(fees.map(({ key, unavailable, numeric }) => [key, unavailable, numeric]), [["promotionDiscount", undefined, true], ["giftWrapFee", undefined, true]]);
  assert.equal(sellfoxColumnValue(fees[0], { promotionDiscount: 12.5 }), 12.5);
  assert.equal(sellfoxColumnValue(fees[0], { promotionDiscount: 0 }), 0);
  assert.equal(sellfoxColumnValue(fees[0], { promotionDiscount: "0" }), "0");
  assert.equal(sellfoxColumnValue(fees[1], { giftWrapFee: 0 }), 0);
  assert.equal(sellfoxColumnValue(fees[1], { giftWrapFee: "0" }), "0");
  assert.match(browseEmptyMessage("sales", { workerOnline: false } as never) ?? "", /Worker.*离线.*立即同步/);
  assert.match(browseEmptyMessage("performance", { workerOnline: true, latestSuccessByResource: {} } as never) ?? "", /尚无销售利润同步成功记录/);
  assert.match(browseEmptyMessage("sales", { workerOnline: true, latestSuccessByResource: { sales: { id: "r", resource: "sales", status: "done", startedAt: "2026-10-26" } } } as never) ?? "", /调整日期范围.*补数/);
});
