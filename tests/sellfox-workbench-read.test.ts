import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { readSellfoxWorkbench, workbenchDateRange, workbenchReadSql } from "@/lib/sellfox/workbench-read";
import { backfillSellfoxViewDates, defaultSellfoxView, readSellfoxView, sellfoxViewParams } from "@/lib/sellfox/workbench-view";
import { browseEmptyMessage, captions, columns, defaultVisibleColumnKeys, visibleColumns, visibleColumnCsv, sellfoxColumnValue, summableColumnKeys } from "@/components/sellfox/workbench-types";
import { sellfoxWorkbenchExport } from "@/lib/sellfox/workbench-export";

// Payload normalization is covered by tests/integration/sellfox-listings-read-model.ts.
function assertListingProjection(sql: string) {
  assert.doesNotMatch(sql, /payload|jsonb_array_elements|JOIN "SellfoxListingSnapshot"|LEFT JOIN/);
  assert.match(sql, /filtered AS NOT MATERIALIZED/);
  assert.match(sql, /FROM sellfox_listing_current s WHERE s\."organizationId"=/);
  for (const key of ["brand", "rating", "productTags", "bsrRank", "listingQuantity", "buyBoxWinner"]) assert.ok(sql.includes(`s."${key}"`));
}

test("performance footer includes visible numeric fees and quantities without summing rates or unavailable columns", () => {
  const keys = ["refundPrice", "refundNum", "commodityCost", "shippingPrice", "taxPrice", "headTripPrice", "avgPurchaseCost", "amazonCommissionPrice", "fbaQuantity", "fbmQuantity", "evaluationSaleNum", "channelSaleNum"];
  assert.deepEqual(summableColumnKeys(visibleColumns("performance", ["identity", ...keys])).sort(), [...keys].sort());
  assert.ok(summableColumnKeys(columns.performance).includes("saleRevenue"));
  assert.deepEqual(summableColumnKeys([
    ...columns.performance.filter(c => ["grossProfitRate", "netProfitRate", "refundRate"].includes(c.key)),
    ...columns.ads.filter(c => ["acos", "roas"].includes(c.key)),
    { ...columns.performance.find(c => c.key === "refundPrice")!, unavailable: true },
  ]), []);
});

test("workbench matrix URL round trips independent dimensions, metric, zero filter and ad filters", () => {
  const input = { ...defaultSellfoxView, domain: "sales" as const, dimension: "parentAsin" as const, metric: "revenue", hideZero: true, shops: ["s1"], from: "2026-10-01", to: "2026-10-07" };
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
test("UI browse SQL binds scope and search text, filters after entity aggregation, and scopes typed listing reads", () => {
  const query = sellfoxBrowseQuery(new URL('http://localhost/?from=2026-10-01&to=2026-10-07&search=%27%3BDROP%20TABLE&hideZero=1&dimension=asin'));
  const sql = workbenchReadSql("sales", query, { organizationId: "org-unique", workspaceId: "workspace-unique" });
  assert.ok(sql.values.includes("org-unique")); assert.ok(sql.values.includes("workspace-unique")); assert.ok(sql.values.includes("%';DROP TABLE%"));
  assert.ok(!sql.text.includes("DROP TABLE")); assert.doesNotMatch(sql.text, /payload|jsonb_array_elements|JOIN "SellfoxListingSnapshot"/);
  assert.ok(sql.values.includes("org-unique"));
  assert.match(sql.text, /bool_and\(complete AND quantity IS NOT NULL\)/);
  assert.match(sql.text, /filtered AS \(SELECT \* FROM grouped WHERE true AND quantity IS DISTINCT FROM 0\)/);
  const ads = workbenchReadSql("ads_report", { ...query, quickFilter: "clicksNoOrders" }, { organizationId: "org", workspaceId: "ws" });
  assert.match(ads.text, /clicks>0 AND "adOrders"=0/);
});
test("sales excludes incomplete null-quantity/null-revenue shells even with orders before day, entity and KPI aggregation", () => {
  const scope = { organizationId: "org", workspaceId: "ws" };
  const shellFilter = "NOT (NOT s.complete AND s.quantity IS NULL AND s.revenue IS NULL)";
  for (const metric of ["quantity", "orders", "revenue"]) {
    for (const dimension of ["msku", "asin", "parentAsin", "store", "developer", "spu"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?metric=${metric}&dimension=${dimension}&from=2026-10-25&to=2026-10-25`));
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("sales", query, scope, exporting).text;
        const base = sql.slice(sql.indexOf("base AS ("), sql.indexOf("days AS ("));
        // Removing shells here protects both shared-identity days and standalone
        // orphan identities from nulling subtotal and daily currency KPIs, even
        // when stale coverage-skew orders are non-null. Complete rows and partial
        // incomplete rows with quantity/revenue (including zero) remain in base.
        assert.ok(base.includes(shellFilter));
        assert.doesNotMatch(base, /s\.orders IS NULL/);
        assert.match(sql, /FROM base GROUP BY/);
        assert.match(sql, /FROM days GROUP BY/);
        assert.match(sql, /FROM filtered GROUP BY currency/);
        assert.ok(sql.includes(`jsonb_object_agg("reportDate",${metric}) AS daily`));
      }
    }
  }
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  for (const domain of ["performance", "ads_report", "listings"] as const) {
    assert.ok(!workbenchReadSql(domain, query, scope).text.includes(shellFilter));
  }
});

test("sales complete sums stay exact and partially known or complete-null rows still propagate unknowns", () => {
  for (const metric of ["quantity", "orders", "revenue"]) {
    const query = sellfoxBrowseQuery(new URL(`http://localhost/?metric=${metric}&from=2026-10-25&to=2026-10-25`));
    const sql = workbenchReadSql("sales", query, { organizationId: "org", workspaceId: "ws" }).text;
    for (const key of ["quantity", "orders", "revenue"]) {
      assert.ok(sql.includes(`CASE WHEN bool_and(complete AND ${key} IS NOT NULL) THEN sum(${key})::float END AS ${key}`));
    }
    assert.ok(sql.includes(`CASE WHEN count("${metric}")=count(*) THEN sum("${metric}")::float END`));
    assert.match(sql, /CASE WHEN count\("subtotal"\)=count\(\*\) THEN sum\("subtotal"\)::float END/);
    assert.match(sql, /CASE WHEN count\(day.value\)=count\(\*\) AND count\(\*\)=/);
    assert.doesNotMatch(sql, /COALESCE\((?:sum\()?"?(?:quantity|orders|revenue|subtotal)\b/);
  }
});

test("developer and SPU use one primary-resolved Listing row per fact without array fan-out", () => {
  const scope = { organizationId: "org", workspaceId: "ws" };
  for (const [domain, dimension, label] of [["sales", "developer", "开发员"], ["sales", "spu", "SPU"], ["performance", "developer", "开发员"]] as const) {
    const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&search=${encodeURIComponent(label)}`));
    const sql = workbenchReadSql(domain, query, scope);
    assert.match(sql.text, /LEFT JOIN LATERAL \(SELECT candidate\.\*/);
    assert.match(sql.text, /s\.msku IS NOT NULL AND candidate\.msku=s\.msku/);
    assert.match(sql.text, /s\.asin IS NOT NULL AND candidate\.asin=s\.asin/);
    assert.match(sql.text, /COALESCE\(l\.developer,'未分配开发员'\) AS developer/);
    assert.doesNotMatch(sql.text, /p\.payload|jsonb_array_elements|JOIN "SellfoxListingSnapshot"/);
    assert.match(sql.text, /COALESCE\(l\.spu,'未分配SPU'\) AS spu/);
    assert.match(sql.text, /FROM base GROUP BY identity,currency/);
    assert.doesNotMatch(sql.text, /GROUP BY "storeId",(?:identity|currency,identity)/);
    assert.match(sql.text, /CASE WHEN count\("storeId"\)=count\(\*\) AND count\(DISTINCT "storeId"\)=1 THEN min\("storeId"\) END AS "storeId"/);
    assert.match(sql.text, /count\(DISTINCT "storeId"\)=1 THEN min\("storeSite"\) END AS marketplace/);
    assert.match(sql.text, /min\(identity\) AS name/);
    assert.match(sql.text, /jsonb_agg\(DISTINCT jsonb_build_array\((?:b\.)?"storeId",(?:b\.)?msku\)\)/);
    if (domain === "sales") {
      assert.match(sql.text, /FROM base GROUP BY identity,currency,"reportDate"/);
      assert.match(sql.text, /FROM days GROUP BY identity,currency/);
      assert.doesNotMatch(sql.text, /b\."storeId"=days\."storeId"/);
    }
    assert.match(sql.text, /COALESCE\(l\.developer,'未分配开发员'\) ILIKE|COALESCE\(l\.spu,'未分配SPU'\) ILIKE/);
    // Label arrays are scalar subqueries; neither labels nor developers fan out fact rows.
    const base = sql.text.slice(sql.text.indexOf("base AS ("), sql.text.indexOf("grouped AS ("));
    assert.doesNotMatch(base, /CROSS JOIN LATERAL jsonb_array_elements/);
    assert.doesNotMatch(sql.text, /CROSS JOIN LATERAL jsonb_array_elements\(CASE WHEN jsonb_typeof\(p.payload->'devList'/);
    assert.ok(sql.values.includes(`%${label}%`));
  }
  assert.match(workbenchReadSql("performance", sellfoxBrowseQuery(new URL("http://localhost/?dimension=spu")), scope).text, /COALESCE\(NULLIF\(s\."asin",''\), NULLIF\(s\.msku,''\), s\.id\) AS identity/);
});
test("store dimension groups by storeId and currency with joined name/site and bound store-name search", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/?dimension=store&from=2026-10-24&to=2026-10-24&search=TK%E5%BA%97"));
  for (const domain of ["sales", "performance"] as const) {
    const sql = workbenchReadSql(domain, query, { organizationId: "org", workspaceId: "ws" });
    assert.match(sql.text, /COALESCE\(NULLIF\(s\."storeId",''\), NULLIF\(s\.msku,''\), s\.id\) AS identity/);
    assert.doesNotMatch(sql.text, /s\."store"/);
    assert.match(sql.text, /st\.name AS "storeName",st\.marketplace AS "storeSite"/);
    assert.match(sql.text, /min\("storeName"\) AS name,min\("storeSite"\) AS marketplace/);
    assert.match(sql.text, /FROM base GROUP BY "storeId",(?:identity,currency|currency,identity)/);
    assert.match(sql.text, /FROM filtered GROUP BY currency/);
    assert.match(sql.text, /st\.name ILIKE \$/);
    assert.ok(sql.values.includes("%TK店%"));
    const exact = workbenchReadSql(domain, { ...query, exactMatch: true }, { organizationId: "org", workspaceId: "ws" });
    assert.match(exact.text, /lower\(st\.name\)=lower\(/);
    assert.ok(exact.values.includes("TK店"));
    assert.doesNotMatch(workbenchReadSql(domain, { ...query, searchType: "asin" }, { organizationId: "org", workspaceId: "ws" }).text, /st\.name ILIKE/);
  }
});

test("product dimensions retain store-scoped identity and sales members", () => {
  for (const domain of ["sales", "performance"] as const) {
    for (const dimension of ["asin", "parentAsin", "msku", "sku"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}`));
      const sql = workbenchReadSql(domain, query, { organizationId: "org", workspaceId: "ws" }).text;
      assert.match(sql, /FROM base GROUP BY "storeId",(?:identity,currency|currency,identity)/);
      assert.doesNotMatch(sql, /AS "stockMembers"/);
      if (domain === "sales") {
        assert.match(sql, /FROM days GROUP BY "storeId",identity,currency/);
        assert.match(sql, /b\."storeId"=days\."storeId"/);
      }
    }
  }
});

test("store rows display joined names and clear ambiguous product fields without mixing currency totals", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  try {
    for (const domain of ["sales", "performance"] as const) {
      const rows = ["USD", "CAD"].map(currency => ({ storeId: "s1", identity: "s1", name: "TK店", marketplace: "US", currency, members: ["m1", "m2"], asin: "asin1", msku: "m1", sku: "sku1", parentAsin: "parent1", title: "商品1" }));
      rows.push({ ...rows[0], storeId: "s2", identity: "s2", name: "单品店", members: ["m1"] });
      const totals = [{ currency: "USD", subtotal: 3 }, { currency: "CAD", subtotal: 5 }];
      globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => sql.text.startsWith("WITH") ? [{ rows, total: rows.length, totals }] : [] } as unknown as PrismaClient;
      const result = await readSellfoxWorkbench(domain, sellfoxBrowseQuery(new URL("http://localhost/?dimension=store&from=2026-10-24&to=2026-10-24")), { organizationId: "org", workspaceId: "ws" });
      assert.deepEqual(result.totals, totals);
      for (const row of result.rows.slice(0, 2)) {
        assert.equal(row.identity, "TK店"); assert.equal(row.marketplace, "US");
        for (const key of ["asin", "msku", "sku", "parentAsin", "title"]) assert.equal(row[key], null);
      }
      assert.equal(result.rows[2].identity, "单品店"); assert.equal(result.rows[2].asin, "asin1"); assert.equal(result.rows[2].msku, "m1");
      const identity = visibleColumns(domain, undefined, [], "store").find(c => c.key === "identity")!;
      assert.equal(identity.labelZh, "店铺");
      assert.equal(sellfoxColumnValue(identity, result.rows[0]), "TK店");
    }
  } finally { globals.prisma = previous; }
});
test("visible-column export matches ordered matrix headers, leaves unsupported values blank and escapes formulas", () => {
  const config = visibleColumns("sales", ["identity", "awdAvailable", "subtotal", "day:2026-10-01"], ["2026-10-01"], "asin");
  assert.deepEqual(config.map(c=>c.labelZh), ["ASIN", "小计", "AWD库存", "10-01"]);
  const csv = visibleColumnCsv(config, [{ identity: "=UNTRUSTED()", awdAvailable: 999, subtotal: null, "day:2026-10-01": 0 }]);
  assert.match(csv, /'=UNTRUSTED/); assert.ok(!csv.includes("999")); assert.match(csv, /"","",0$/);
  assert.deepEqual(visibleColumns("performance", []).map(c=>c.key), []);
});

test("rollup defaults omit duplicate names and product clutter while preserving core metrics and picker overrides", () => {
  const sales = ["image", "identity", "analysis", "brand", "productTags", "price", "fulfillable", "subtotal", "trend", "average7", "totalInventory"];
  const performance = ["image", "identity", "analysis", "grossProfit", "grossProfitRate", "netProfitRate", "saleRevenue", "netRevenue", "orderNum", "fulfillable", "saleQuantity", "evaluationSaleNum", "channelSaleNum", "promotionDiscount", "giftWrapFee", "adCost", "currency", "salesperson"];
  for (const dimension of ["store", "developer", "spu"]) {
    for (const [domain, expected] of [["sales", sales], ["performance", performance]] as const) {
      assert.deepEqual(defaultVisibleColumnKeys(domain, dimension), expected);
      const config = visibleColumns(domain, undefined, [], dimension);
      assert.deepEqual(config.map(c => c.key), expected);
      const identity = config.find(c => c.key === "identity")!;
      assert.equal(identity.labelZh, ({ store: "店铺", developer: "开发员", spu: "SPU" })[dimension]);
      assert.equal(sellfoxColumnValue(identity, { identity: "汇总", title: "商品标题" }), "汇总");
      const hidden = columns[domain].filter(c => !expected.includes(c.key)).map(c => c.key);
      assert.deepEqual(visibleColumns(domain, hidden, [], dimension).map(c => c.key), hidden);
      assert.deepEqual(visibleColumns(domain, [], [], dimension), []);
    }
    const dates = ["2026-10-24", "2026-10-25"];
    assert.deepEqual(visibleColumns("sales", undefined, dates, dimension, true).map(c => c.key), [...sales, ...dates.map(date => `day:${date}`)]);
    assert.deepEqual(visibleColumns("sales", ["subtotal"], dates, dimension, true).map(c => c.key), ["subtotal", ...dates.map(date => `day:${date}`)]);
  }
});

test("sales product defaults omit unavailable operations columns while other defaults stay unchanged", () => {
  const sales = ["image", "identity", "name", "analysis", "parentAsin", "msku", "sku", "title", "brand", "productTags", "price", "fulfillable", "subtotal", "trend", "average7", "totalInventory"];
  const performance = ["image", "identity", "name", "analysis", "parentAsin", "sku", "grossProfit", "grossProfitRate", "netProfitRate", "saleRevenue", "netRevenue", "orderNum", "fulfillable", "saleQuantity", "evaluationSaleNum", "channelSaleNum", "promotionDiscount", "giftWrapFee", "adCost", "currency", "salesperson"];
  for (const dimension of ["asin", "msku", "sku", "parentAsin"]) {
    assert.deepEqual(defaultVisibleColumnKeys("sales", dimension), sales);
    assert.deepEqual(visibleColumns("sales", undefined, [], dimension).map(c => c.key), sales);
    assert.deepEqual(defaultVisibleColumnKeys("performance", dimension), performance);
    const config = visibleColumns("performance", undefined, [], dimension);
    assert.deepEqual(config.map(c => c.key), performance);
    assert.deepEqual(config.find(c => c.key === "identity")?.parts, ["title", "identity"]);
  }
  for (const domain of ["listings", "ads"]) {
    for (const dimension of ["msku", "store", "developer", "spu"]) {
      assert.deepEqual(defaultVisibleColumnKeys(domain, dimension), columns[domain].filter(c => c.defaultVisible).map(c => c.key));
    }
  }
});

test("sales unavailable operations columns remain selectable and explicitly exportable in every dimension", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const scope = { organizationId: "org", workspaceId: "ws" };
  const keys = ["operations", "salesInsight"];
  globals.prisma = { $queryRaw: async () => [{ rows: [{ operations: "unsupported", salesInsight: "unsupported" }], total: 1, totals: [] }] } as unknown as PrismaClient;
  try {
    for (const dimension of ["asin", "msku", "sku", "parentAsin", "store", "developer", "spu"]) {
      const config = visibleColumns("sales", keys, [], dimension);
      assert.deepEqual(config.map(c => c.key), keys);
      assert.ok(config.every(c => c.unavailable && !c.defaultVisible));
      const url = new URL(`http://localhost/?dimension=${dimension}&from=2026-10-25&to=2026-10-25`);
      const query = sellfoxBrowseQuery(url);
      const defaults = await (await sellfoxWorkbenchExport("sales", query, scope, url)).text();
      assert.ok(!defaults.includes('"运营"') && !defaults.includes('"销量洞察"'));
      for (const key of keys) url.searchParams.append("column", key);
      const custom = await (await sellfoxWorkbenchExport("sales", query, scope, url)).text();
      assert.equal(custom.trim(), '"运营","销量洞察"\r\n"",""');
    }
  } finally { globals.prisma = previous; }
});

test("workbench CSV export resolves rollup defaults without column params and honors explicit columns", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const scope = { organizationId: "org", workspaceId: "ws" };
  globals.prisma = { $queryRaw: async () => [{ rows: [{ identity: "汇总", name: "汇总", title: "商品标题", subtotal: 3, saleQuantity: 3 }], total: 1, totals: [] }] } as unknown as PrismaClient;
  try {
    for (const domain of ["sales", "performance"] as const) {
      for (const dimension of ["store", "developer", "spu"]) {
        const url = new URL(`http://localhost/?dimension=${dimension}&from=2026-10-25&to=2026-10-25`);
        const query = sellfoxBrowseQuery(url);
        const csv = await (await sellfoxWorkbenchExport(domain, query, scope, url)).text();
        const expected = visibleColumnCsv(visibleColumns(domain, undefined, [], dimension), []).trim();
        assert.equal(csv.trim().split("\r\n")[0], expected);
        assert.ok(!csv.includes("商品标题"));
        url.searchParams.append("column", "name"); url.searchParams.append("column", "title");
        const custom = await (await sellfoxWorkbenchExport(domain, query, scope, url)).text();
        assert.equal(custom.trim().split("\r\n")[0], '"店铺/站点","标题"');
        assert.ok(custom.includes("商品标题"));
      }
    }
  } finally { globals.prisma = previous; }
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
  assert.deepEqual(sales.map(c=>c.key),["image","identity","name","analysis","parentAsin","msku","sku","title","brand","productTags","price","fulfillable","subtotal","trend","average7","totalInventory"]);
  const store = sales.find(c=>c.key === "name")!;
  assert.equal(sellfoxColumnValue(store,{name:"店铺",marketplace:"US"}),"店铺\nUS");
  const profit = visibleColumns("performance",undefined,[],"msku").find(c=>c.key === "identity")!;
  assert.equal(profit.labelZh,"标题/MSKU");
  assert.equal(sellfoxColumnValue(profit,{title:"商品",identity:"MSKU-1",payload:{title:"错误来源"}}),"商品\nMSKU-1");
  const developer = visibleColumns("performance",undefined,[],"developer").find(c=>c.key === "identity")!;
  assert.equal(developer.labelZh,"开发员");
  assert.equal(sellfoxColumnValue(developer,{title:"商品",identity:"开发员甲"}),"开发员甲");
  const csv = visibleColumnCsv([profit],[{title:"商品",identity:"MSKU-1"}]);
  assert.match(csv,/"商品\nMSKU-1"/);
  assert.equal(sellfoxColumnValue(profit,{identity:"MSKU-1"}),"MSKU-1");
  const listing = visibleColumns("listings").find(c=>c.key === "asin")!;
  assert.equal(sellfoxColumnValue(listing,{asin:"ASIN-1",msku:"MSKU-1"}),"ASIN-1\nMSKU-1");
  assert.deepEqual(visibleColumns("ads").slice(0, 2).map(c => c.key), ["image", "asin"]);
  assert.ok(!visibleColumns("ads").some(c=>["msku","title","name","marketplace"].includes(c.key)));
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

test("listings default-show totalInventory with optional inventoryCapturedAt immediately after fulfillable without changing other domains", () => {
  const keys = columns.listings.map(c => c.key);
  assert.deepEqual(keys.slice(keys.indexOf("fulfillable"), keys.indexOf("fulfillable") + 3), ["fulfillable", "totalInventory", "inventoryCapturedAt"]);
  const config = visibleColumns("listings", ["inventoryCapturedAt", "totalInventory", "fulfillable"]);
  assert.deepEqual(config.map(c => c.key), ["fulfillable", "totalInventory", "inventoryCapturedAt"]);
  assert.deepEqual(config.map(c => c.labelZh), ["可售", "总库存", "库存快照时间"]);
  assert.equal(config[1].requiresField, "sellfox_inventory_current.totalInventory（按 storeId+msku 最新完整库存快照汇总；非销售日库存）");
  assert.equal(config[2].requiresField, "sellfox_inventory_current.capturedAt（最新完整库存快照）");
  assert.equal(config[1].numeric, true);
  assert.equal(config[2].numeric, undefined);
  assert.equal(config[1].defaultVisible, true);
  assert.ok(defaultVisibleColumnKeys("listings").includes("totalInventory"));
  assert.equal(config[2].defaultVisible, false);
  assert.ok(!defaultVisibleColumnKeys("listings").includes("inventoryCapturedAt"));
  for (const column of config.slice(1)) assert.equal(column.unavailable, undefined);
  assert.deepEqual(summableColumnKeys(config), ["fulfillable", "totalInventory"]);
  const sales = visibleColumns("sales", ["inventoryCapturedAt", "totalInventory", "fulfillable"]);
  assert.deepEqual(sales.map(c => c.key), ["fulfillable", "totalInventory", "inventoryCapturedAt"]);
  assert.equal(sales[1].numeric, true);
  assert.equal(sales[1].defaultVisible, true);
  assert.equal(sales[2].defaultVisible, false);
  assert.ok(sales.slice(1).every(c => !c.unavailable));
  for (const domain of ["ads", "performance"]) assert.deepEqual(visibleColumns(domain, ["totalInventory", "inventoryCapturedAt"]), []);
});

test("Listing payload stock columns stay optional, summable and contiguous with the inventory cluster", () => {
  const keys = ["listingQuantity", "unsellable", "warehousing"];
  const cluster = ["fulfillable", "totalInventory", "inventoryCapturedAt", ...keys];
  const configured = columns.listings.map(c => c.key);
  assert.deepEqual(configured.slice(configured.indexOf("fulfillable"), configured.indexOf("fulfillable") + cluster.length), cluster);
  assert.deepEqual(visibleColumns("listings", [...cluster].reverse()).map(c => c.key), cluster);
  const config = visibleColumns("listings", [...keys].reverse());
  assert.deepEqual(config.map(c => c.labelZh), ["Listing库存", "不可售", "入库中"]);
  assert.deepEqual(summableColumnKeys(config), keys);
  for (const c of config) {
    assert.equal(c.numeric, true);
    assert.equal(c.defaultVisible, false);
    assert.equal(c.unavailable, undefined);
    assert.equal(c.requiresField, `Listing 当前快照 payload.${c.key === "listingQuantity" ? "quantity" : c.key}`);
    assert.ok(!defaultVisibleColumnKeys("listings").includes(c.key));
    for (const value of [null, 0, 48]) assert.equal(sellfoxColumnValue(c, { [c.key]: value }), value);
    assert.equal(sellfoxColumnValue(c, {}), undefined);
  }
  assert.ok(!configured.includes("quantity"));
  for (const domain of ["sales", "performance", "ads"]) assert.deepEqual(visibleColumns(domain, keys), []);
});

test("Listing payload stock SQL extracts and projects separate nullable numbers only for listings", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  const scope = { organizationId: "org", workspaceId: "ws" };
  for (const exporting of [false, true]) {
    const sql = workbenchReadSql("listings", query, scope, exporting).text;
    assertListingProjection(sql);
    for (const domain of ["sales", "performance", "ads_report"] as const) {
      const otherSql = workbenchReadSql(domain, query, scope, exporting).text;
      assert.doesNotMatch(otherSql, /listingQuantity|unsellable|warehousing|p\.payload->>'quantity'/);
    }
  }
});

test("Listing payload stock exports null, zero and 48 in CSV/XLSX independently of inventory values", async () => {
  const keys = ["fulfillable", "totalInventory", "listingQuantity", "unsellable", "warehousing"];
  const labels = ["可售", "总库存", "Listing库存", "不可售", "入库中"];
  const rows = [null, 0, 48, undefined].map((value, index) => ({
    storeId: "s1", msku: `m${index}`, fulfillable: 19,
    ...(value === undefined ? {} : { listingQuantity: value, unsellable: value, warehousing: value }),
  }));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => sql.text.startsWith("WITH")
    ? [{ rows, total: rows.length, totals: [] }]
    : rows.map(row => ({ storeId: row.storeId, msku: row.msku, fulfillable: 99, totalInventory: 180 })) } as unknown as PrismaClient;
  const url = new URL("http://localhost/?column=warehousing&column=unsellable&column=listingQuantity&column=totalInventory&column=fulfillable&format=csv");
  const scope = { organizationId: "org", workspaceId: "ws" };
  try {
    const csv = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    assert.equal((await csv.text()).trim(), '"可售","总库存","Listing库存","不可售","入库中"\r\n19,180,"","",""\r\n19,180,0,0,0\r\n19,180,48,48,48\r\n19,180,"","",""');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.columnCount, keys.length);
    assert.deepEqual(keys.map((_, index) => sheet.getRow(1).getCell(index + 1).value), labels);
    for (const [index, value] of [null, 0, 48, null].entries()) {
      assert.deepEqual(keys.map((_, column) => sheet.getRow(index + 2).getCell(column + 1).value), [19, 180, value, value, value]);
    }
  } finally { globals.prisma = previous; }
});

test("default and selected listing inventory columns preserve null, zero and 180 numeric stock in CSV/XLSX", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const capturedAt = "2026-10-26T10:20:30.000Z";
  const stocks = [null, 0, 180].map((totalInventory, index) => ({ storeId: "s1", msku: `m${index}`, totalInventory, inventoryCapturedAt: totalInventory === null ? null : capturedAt }));
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => sql.text.startsWith("WITH")
    ? [{ rows: stocks.map(stock => ({ storeId: stock.storeId, msku: stock.msku, fulfillable: 19 })), total: stocks.length, totals: [] }]
    : stocks } as unknown as PrismaClient;
  const url = new URL("http://localhost/?column=inventoryCapturedAt&column=totalInventory&column=fulfillable&format=csv");
  const scope = { organizationId: "org", workspaceId: "ws" };
  try {
    const csv = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    assert.equal((await csv.text()).trim(), `"可售","总库存","库存快照时间"\r\n19,"",""\r\n19,0,"${capturedAt}"\r\n19,180,"${capturedAt}"`);
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.columnCount, 3);
    assert.deepEqual(sheet.getRow(1).values, [, "可售", "总库存", "库存快照时间"]);
    assert.equal(sheet.getRow(2).getCell(1).value, 19);
    assert.equal(sheet.getRow(2).getCell(2).value, null);
    assert.equal(sheet.getRow(2).getCell(3).value, null);
    assert.deepEqual(sheet.getRow(3).values, [, 19, 0, capturedAt]);
    assert.deepEqual(sheet.getRow(4).values, [, 19, 180, capturedAt]);

    const defaultUrl = new URL("http://localhost/");
    const defaultCsv = (await (await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(defaultUrl), scope, defaultUrl)).text()).trim().split("\r\n");
    const inventoryIndex = defaultCsv[0].split(",").indexOf('"总库存"');
    assert.ok(inventoryIndex > 0);
    assert.equal(defaultCsv[0].split(",")[inventoryIndex - 1], '"可售"');
    assert.ok(!defaultCsv[0].includes('"库存快照时间"'));
    assert.deepEqual(defaultCsv.slice(1).map(row => row.split(",")[inventoryIndex]), ['""', "0", "180"]);
    const defaultInventory = visibleColumns("listings").find(column => column.key === "totalInventory")!;
    for (const value of [null, 0, 180]) assert.equal(sellfoxColumnValue(defaultInventory, { totalInventory: value }), value);

    defaultUrl.searchParams.set("format", "xlsx");
    const defaultBook = new ExcelJS.Workbook();
    await defaultBook.xlsx.load(await (await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(defaultUrl), scope, defaultUrl)).arrayBuffer());
    const defaultSheet = defaultBook.worksheets[0];
    assert.equal(defaultSheet.getRow(1).getCell(inventoryIndex).value, "可售");
    assert.equal(defaultSheet.getRow(1).getCell(inventoryIndex + 1).value, "总库存");
    assert.deepEqual([2, 3, 4].map(row => defaultSheet.getRow(row).getCell(inventoryIndex + 1).value), [null, 0, 180]);
  } finally { globals.prisma = previous; }
});

test("listings expose brand and rating from the scoped current Listing snapshot", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/?status=active"));
  const sql = workbenchReadSql("listings", query, { organizationId: "org", workspaceId: "ws" });
  assertListingProjection(sql.text);
  const brand = visibleColumns("listings", ["brand"]).find(c => c.key === "brand")!;
  const rating = visibleColumns("listings", ["rating"]).find(c => c.key === "rating")!;
  assert.equal(brand.unavailable, undefined);
  assert.equal(rating.unavailable, undefined);
  assert.equal(brand.defaultVisible, true);
  assert.equal(rating.defaultVisible, true);
  const defaults = defaultVisibleColumnKeys("listings");
  assert.deepEqual(defaults, ["status", "fulfillment", "image", "asin", "title", "brand", "amazonBrand", "rating", "ratingCount", "openDate", "buyBoxWinner", "parentAsin", "sku", "name", "price", "sales7", "sales14", "sales30", "revenue7", "revenue14", "revenue30", "adSpend7", "adSpend14", "adSpend30", "fulfillable", "totalInventory", "sourceUpdatedAt"]);
  assert.deepEqual(visibleColumns("listings").map(c => c.key), defaults);
  for (const key of ["inventoryCapturedAt", "listingQuantity", "unsellable", "warehousing", "firstSaleDate", "productTags", "bsrRank", "bsrCategory", "purchaseCost", "fbaFees", "referralFee", "totalFee", "headTripCost", "dxmPublishState", "salesperson"]) assert.ok(!defaults.includes(key));
  const sourceKeys = columns.listings.map(c => c.key);
  assert.deepEqual(sourceKeys.slice(0, 4), ["status", "dxmPublishState", "fulfillment", "image"]);
  assert.deepEqual(sourceKeys.slice(sourceKeys.indexOf("brand"), sourceKeys.indexOf("ratingCount") + 1), ["brand", "amazonBrand", "rating", "ratingCount"]);
  for (const selected of [[], ["title", "asin"], ["rating"], ["brand"], ["amazonBrand"], ["ratingCount"], ["buyBoxWinner"], ["openDate"], ["totalInventory"], ["fulfillment"], defaults.filter(key => key !== "amazonBrand"), defaults.filter(key => key !== "fulfillment"), defaults.filter(key => key !== "totalInventory"), defaults.filter(key => key !== "openDate"), defaults.filter(key => !["ratingCount", "buyBoxWinner"].includes(key))]) {
    const original = [...selected];
    assert.deepEqual(visibleColumns("listings", selected).map(c => c.key), sourceKeys.filter(key => original.includes(key)));
    assert.deepEqual(selected, original);
  }
  assert.equal(sellfoxColumnValue(brand, { brand: "Acme" }), "Acme");
  assert.equal(sellfoxColumnValue(rating, { rating: "4.4" }), "4.4");
  assert.equal(visibleColumnCsv([brand, rating], [{ brand: "Acme", rating: "4.4" }]).trim(), '"品牌","星级"\r\n"Acme","4.4"');
});

test("listings default CSV/XLSX include fulfillment, brand, amazonBrand, rating, ratingCount, openDate, Buy Box and totalInventory while explicit selections stay authoritative", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const rows = [{ fulfillment: "AFN", brand: "Acme", amazonBrand: "ACME", rating: "4.4", ratingCount: 128, openDate: "2024-01-15", buyBoxWinner: "是", title: "Sample" }, { fulfillment: null, brand: null, amazonBrand: null, rating: null, ratingCount: null, openDate: null, buyBoxWinner: null, title: "Missing" }, { fulfillment: "MFN", brand: "00123", amazonBrand: "00123", rating: "0", ratingCount: 0, buyBoxWinner: "否", title: "Zero" }, { title: "Absent" }];
  globals.prisma = { $queryRaw: async () => [{ total: rows.length, totals: [], rows }] } as unknown as PrismaClient;
  try {
    const { default: ExcelJS } = await import("exceljs");
    const hiddenAmazonBrand = new URLSearchParams(defaultVisibleColumnKeys("listings").filter(key => key !== "amazonBrand").map(key => ["column", key])).toString();
    const hiddenFulfillment = new URLSearchParams(defaultVisibleColumnKeys("listings").filter(key => key !== "fulfillment").map(key => ["column", key])).toString();
    const hiddenOpenDate = new URLSearchParams(defaultVisibleColumnKeys("listings").filter(key => key !== "openDate").map(key => ["column", key])).toString();
    const hiddenTotalInventory = new URLSearchParams(defaultVisibleColumnKeys("listings").filter(key => key !== "totalInventory").map(key => ["column", key])).toString();
    for (const layout of ["", "layout=workbench&"]) for (const selection of ["", "column=title", "column=fulfillment", "column=brand", "column=amazonBrand", "column=rating", "column=ratingCount", "column=openDate", "column=buyBoxWinner", "columns=custom", hiddenAmazonBrand, hiddenFulfillment, hiddenOpenDate, hiddenTotalInventory]) {
      const url = new URL(`http://localhost/?${layout}${selection}`);
      const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
      const keys = selection ? url.searchParams.getAll("column") : defaultVisibleColumnKeys("listings");
      const config = visibleColumns("listings", keys);
      const csv = await (await sellfoxWorkbenchExport("listings", query, scope, url)).text();
      assert.equal(csv.trim(), visibleColumnCsv(config, rows).trim());
      if (!selection) assert.match(csv.split("\r\n")[0], /"标题","品牌","亚马逊品牌","星级","评论数","上架时间","Buy Box","父ASIN"/);
      url.searchParams.set("format", "xlsx");
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await (await sellfoxWorkbenchExport("listings", query, scope, url)).arrayBuffer());
      const sheet = book.worksheets[0];
      assert.equal(sheet.columnCount, keys.length);
      if (!selection) assert.deepEqual([7, 8, 9, 10, 11, 12].map(index => sheet.getRow(1).getCell(index).value), ["亚马逊品牌", "星级", "评论数", "上架时间", "Buy Box", "父ASIN"]);
      if (!selection) {
        assert.match(csv.split("\r\n")[0], /^"状态","发货方式","图片"/);
        assert.equal(sheet.getRow(1).getCell(2).value, "发货方式");
        assert.deepEqual([2, 3, 4, 5].map(row => sheet.getRow(row).getCell(2).value), ["AFN", null, "MFN", null]);
        assert.match(csv.split("\r\n")[0], /"可售","总库存","更新时间"/);
        const inventoryIndex = keys.indexOf("totalInventory");
        assert.equal(sheet.getRow(1).getCell(inventoryIndex).value, "可售");
        assert.equal(sheet.getRow(1).getCell(inventoryIndex + 1).value, "总库存");
      }
      if (selection && !keys.includes("amazonBrand")) {
        assert.ok(!csv.split("\r\n")[0].includes('"亚马逊品牌"'));
        assert.ok(!config.some(column => column.key === "amazonBrand"));
      }
      if (selection && !keys.includes("fulfillment")) {
        assert.ok(!csv.split("\r\n")[0].includes('"发货方式"'));
        assert.ok(!config.some(column => column.key === "fulfillment"));
      }
      if (selection && !keys.includes("openDate")) assert.ok(!config.some(column => column.key === "openDate"));
      if (selection === hiddenTotalInventory || selection === "column=title" || selection === "columns=custom") {
        assert.ok(!csv.split("\r\n")[0].includes('"总库存"'));
        assert.ok(!config.some(column => column.key === "totalInventory"));
      }
      for (const [i, column] of config.entries()) {
        assert.equal(sheet.getRow(1).getCell(i + 1).value, column.labelZh);
        for (const [r, row] of rows.entries()) assert.equal(sheet.getRow(r + 2).getCell(i + 1).value, sellfoxColumnValue(column, row) ?? null);
      }
    }
  } finally { globals.prisma = previous; }
});

test("listings default-show amazonBrand and keep bsrCategory optional as text columns in source order", () => {
  const keys = columns.listings.map(c => c.key);
  assert.equal(keys.indexOf("amazonBrand"), keys.indexOf("brand") + 1);
  assert.equal(keys.indexOf("bsrCategory"), keys.indexOf("bsrRank") + 1);
  const config = visibleColumns("listings", ["bsrCategory", "amazonBrand"]);
  assert.deepEqual(config.map(c => c.key), ["amazonBrand", "bsrCategory"]);
  assert.deepEqual(config.map(c => c.labelZh), ["亚马逊品牌", "BSR类目"]);
  assert.deepEqual(config.map(c => c.requiresField), ["Listing 当前快照 payload.amazonBrand", "Listing 当前快照 payload.bsrRank[].categoryName（与 BSR 同元素，优先 bigCategory）"]);
  for (const column of config) {
    assert.equal(column.unavailable, undefined);
    assert.equal(column.numeric, undefined);
    assert.equal(column.defaultVisible, column.key === "amazonBrand");
    assert.equal(defaultVisibleColumnKeys("listings").includes(column.key), column.key === "amazonBrand");
    assert.equal(sellfoxColumnValue(column, { [column.key]: null }), null);
  }
  assert.equal(sellfoxColumnValue(config[0], { brand: "Goghost-乐器", amazonBrand: "GOGHOST" }), "GOGHOST");
  assert.equal(sellfoxColumnValue(config[1], { bsrRank: 1381, bsrCategory: "Musical Instruments" }), "Musical Instruments");
  assert.deepEqual(summableColumnKeys(config), []);
  for (const domain of ["ads", "sales", "performance"]) assert.deepEqual(visibleColumns(domain, ["amazonBrand", "bsrCategory"]), []);
});

test("listing-only amazonBrand is trimmed and bsrCategory selects the same element as numeric BSR", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  const scope = { organizationId: "org", workspaceId: "ws" };
  for (const exporting of [false, true]) {
    const sql = workbenchReadSql("listings", query, scope, exporting);
    assertListingProjection(sql.text);
    for (const domain of ["sales", "performance", "ads_report"] as const) {
      assert.doesNotMatch(workbenchReadSql(domain, query, scope, exporting).text, /amazonBrand|bsrCategory/);
    }
  }
});

test("selected listing amazonBrand and bsrCategory export text and empty CSV/XLSX cells", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const rows = [
    { brand: "Goghost-乐器", amazonBrand: "GOGHOST", bsrCategory: "Musical Instruments" },
    { amazonBrand: null, bsrCategory: null },
    { amazonBrand: "", bsrCategory: "" },
    { amazonBrand: "00123", bsrCategory: "00456" },
  ];
  globals.prisma = { $queryRaw: async () => [{ rows, total: rows.length, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?column=amazonBrand&column=bsrCategory&format=csv");
  const scope = { organizationId: "org", workspaceId: "ws" };
  try {
    const csv = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    assert.equal((await csv.text()).trim(), '"亚马逊品牌","BSR类目"\r\n"GOGHOST","Musical Instruments"\r\n"",""\r\n"",""\r\n"00123","00456"');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.columnCount, 2);
    assert.deepEqual(sheet.getRow(1).values, [, "亚马逊品牌", "BSR类目"]);
    assert.deepEqual(sheet.getRow(2).values, [, "GOGHOST", "Musical Instruments"]);
    for (const column of [1, 2]) {
      assert.equal(sheet.getRow(3).getCell(column).value, null);
      assert.ok([null, ""].includes(sheet.getRow(4).getCell(column).value as null | string));
    }
    assert.deepEqual(sheet.getRow(5).values, [, "00123", "00456"]);
  } finally { globals.prisma = previous; }
});

test("ads default to current Listing image before product info plus rating, ratingCount and Buy Box across all report tabs", () => {
  const scope = { organizationId: "org", workspaceId: "ws" };
  const keys = ["image", "rating", "productTags"];
  for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
    const columnDomain = domain === "ads_report" ? "ads" : domain;
    const config = visibleColumns(columnDomain, keys);
    assert.deepEqual(config.map(c => c.key), keys);
    assert.deepEqual(config.map(c => c.labelZh), ["图片", "星级", "标签"]);
    for (const c of config) {
      assert.equal(c.unavailable, undefined);
      assert.equal(c.defaultVisible, c.key !== "productTags");
      assert.match(c.requiresField!, /Listing 当前快照/);
      assert.equal(defaultVisibleColumnKeys(columnDomain).includes(c.key), c.key !== "productTags");
    }
    assert.deepEqual(config[0].parts, ["mainImage"]);
    assert.match(config[0].requiresField!, /mainImage/);
    assert.match(config[1].requiresField!, /rating 类型投影/);
    assert.match(config[2].requiresField!, /productTags.*productLabelList/);
    const defaults = defaultVisibleColumnKeys(columnDomain);
    assert.deepEqual(defaults.slice(defaults.indexOf("image"), defaults.indexOf("image") + 4), ["image", "asin", "enabled", "serviceStatus"]);
    assert.deepEqual(defaults.slice(defaults.indexOf("price"), defaults.indexOf("price") + 3), ["price", "rating", "ratingCount"]);
    const sourceKeys = columns[columnDomain].map(c => c.key);
    assert.deepEqual(sourceKeys.slice(sourceKeys.indexOf("brand"), sourceKeys.indexOf("buyBoxWinner") + 1), ["brand", "fulfillment", "buyBoxWinner"]);
    assert.deepEqual(columns[columnDomain].slice(-4).map(c => c.key), ["msku", "title", "name", "marketplace"]);
    for (const key of ["msku", "title", "name", "marketplace"]) assert.equal(columns[columnDomain].find(c => c.key === key)!.defaultVisible, false);
    assert.deepEqual(visibleColumns(columnDomain, ["asin", "cost"]).map(c => c.key), ["asin", "cost"]);
    assert.deepEqual(visibleColumns(columnDomain, []), []);
    for (const key of ["enabled", "serviceStatus", "adStrategy", "salesperson"]) assert.equal(columns[columnDomain].find(c => c.key === key)!.unavailable, true);
    assert.ok(!columns[columnDomain].some(c => /广告组合|否定|AMC/.test(c.labelZh) && !c.unavailable));
    const textConfig = visibleColumns(columnDomain, ["buyBoxWinner", "fulfillment", "brand"]);
    assert.deepEqual(textConfig.map(c => c.key), ["brand", "fulfillment", "buyBoxWinner"]);
    assert.deepEqual(textConfig.map(c => c.labelZh), ["品牌", "发货方式", "Buy Box"]);
    for (const c of textConfig) {
      assert.equal(c.unavailable, undefined);
      assert.equal(c.defaultVisible, c.key === "buyBoxWinner");
      assert.ok(!c.numeric);
      assert.equal(defaults.includes(c.key), c.key === "buyBoxWinner");
      assert.match(c.requiresField!, new RegExp(`Listing 当前快照 ${c.key} 类型投影`));
      for (const value of [null, "", "00123"]) assert.equal(sellfoxColumnValue(c, { [c.key]: value }), value);
    }
    assert.equal(visibleColumnCsv(textConfig.slice(0, 2), [{ brand: "品牌", fulfillment: "AFN" }, { brand: "00123", fulfillment: "MFN" }, { brand: "", fulfillment: "未知" }, { brand: null, fulfillment: null }]).trim(), '"品牌","发货方式"\r\n"品牌","AFN"\r\n"00123","MFN"\r\n"","未知"\r\n"",""');
    const [buyBoxWinner] = visibleColumns(columnDomain, ["buyBoxWinner"]);
    assert.equal(buyBoxWinner.requiresField, "Listing 当前快照 buyBoxWinner 类型投影（boolean→是/否）");
    for (const value of [null, "是", "否"]) assert.equal(sellfoxColumnValue(buyBoxWinner, { buyBoxWinner: value }), value);
    assert.equal(sellfoxColumnValue(buyBoxWinner, {}), undefined);
    assert.equal(visibleColumnCsv([buyBoxWinner], [{ buyBoxWinner: null }, { buyBoxWinner: "是" }, { buyBoxWinner: "否" }, {}]).trim(), '"Buy Box"\r\n""\r\n"是"\r\n"否"\r\n""');
    const [ratingCount] = visibleColumns(columnDomain, ["ratingCount"]);
    assert.equal(ratingCount.labelZh, "评论数");
    assert.equal(ratingCount.numeric, true);
    assert.equal(ratingCount.defaultVisible, true);
    assert.equal(ratingCount.unavailable, undefined);
    assert.equal(ratingCount.requiresField, "Listing 当前快照 ratingCount 类型投影");
    assert.ok(defaults.includes("ratingCount"));
    for (const value of [null, 0, 128]) assert.equal(sellfoxColumnValue(ratingCount, { ratingCount: value }), value);
    assert.equal(visibleColumnCsv([ratingCount], [{ ratingCount: null }, { ratingCount: 0 }, { ratingCount: 128 }]).trim(), '"评论数"\r\n""\r\n0\r\n128');
    for (const exporting of [false, true]) for (const sortBy of ["rating", "ratingCount", "productTags", "brand", "fulfillment", "buyBoxWinner"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${sortBy}&sortOrder=desc&productTag=标签&brand=00123&fulfillment=AFN&buyBox=yes`), domain);
      const sql = workbenchReadSql(domain, query, scope, exporting);
      assert.match(sql.text, /l\.rating AS "listingRating",l\."ratingCount" AS "listingRatingCount",l\."productTags" AS "listingProductTags"/);
      assert.match(sql.text, /min\(NULLIF\("listingMainImage",''\)\) AS "mainImage"/);
      assert.match(sql.text, /CASE WHEN count\("listingRatingCount"\)=count\(\*\) AND count\(DISTINCT "listingRatingCount"\)=1 THEN min\("listingRatingCount"\) END AS "ratingCount"/);
      assert.match(sql.text, /CASE WHEN count\("listingRating"\)=count\(\*\) AND count\(DISTINCT "listingRating"\)=1 THEN min\("listingRating"\) END AS rating/);
      assert.match(sql.text, /CASE WHEN count\("listingProductTags"\)=count\(\*\) AND count\(DISTINCT "listingProductTags"\)=1 THEN min\("listingProductTags"\) END AS "productTags"/);
      assert.match(sql.text, /l\.brand AS "listingBrand",l\.fulfillment AS "listingFulfillment"/);
      assert.match(sql.text, /CASE WHEN count\("listingBrand"\)=count\(\*\) AND count\(DISTINCT "listingBrand"\)=1 THEN min\("listingBrand"\) END AS brand/);
      assert.match(sql.text, /CASE WHEN count\("listingFulfillment"\)=count\(\*\) AND count\(DISTINCT "listingFulfillment"\)=1 THEN min\("listingFulfillment"\) END AS fulfillment/);
      assert.match(sql.text, /l\."buyBoxWinner" AS "listingBuyBoxWinner"/);
      assert.match(sql.text, /CASE WHEN count\("listingBuyBoxWinner"\)=count\(\*\) AND count\(DISTINCT "listingBuyBoxWinner"\)=1 THEN min\("listingBuyBoxWinner"\) END AS "buyBoxWinner"/);
      assert.ok(sql.text.includes(`ORDER BY "${sortBy}" DESC NULLS LAST, id ASC`));
      assert.doesNotMatch(sql.text, /payload/);
      assert.match(sql.text, /AND l\."buyBoxWinner"=/); assert.ok(sql.values.includes("是"));
      assert.match(sql.text, /AND l.brand=/); assert.ok(sql.values.includes("00123"));
      assert.match(sql.text, /AND l.fulfillment=/); assert.ok(sql.values.includes("AFN"));
      assert.ok(sql.values.includes(scope.organizationId)); assert.ok(sql.values.includes(scope.workspaceId));
    }
    assert.equal(visibleColumnCsv(config, [{ rating: "4.4", productTags: "新品、重点", mainImage: "https://example.test/product.jpg" }, { rating: null, productTags: null, mainImage: null }]).trim(), '"图片","星级","标签"\r\n"https://example.test/product.jpg","4.4","新品、重点"\r\n"","",""');
  }
});

test("listings default-show numeric ratingCount from the current snapshot without losing null or zero", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  const scope = { organizationId: "org", workspaceId: "ws" };
  const sql = workbenchReadSql("listings", query, scope);
  assertListingProjection(sql.text);
  const config = visibleColumns("listings", ["ratingCount"]);
  assert.equal(config.length, 1);
  assert.equal(config[0].labelZh, "评论数");
  assert.equal(config[0].unavailable, undefined);
  assert.equal(config[0].numeric, true);
  assert.equal(config[0].defaultVisible, true);
  assert.equal(config[0].requiresField, "Listing 当前快照 payload.ratingCount");
  assert.ok(defaultVisibleColumnKeys("listings").includes("ratingCount"));
  assert.deepEqual(visibleColumns("listings", ["rating", "ratingCount", "productTags"]).map(c => c.key), ["rating", "ratingCount", "productTags"]);
  assert.equal(sellfoxColumnValue(config[0], { ratingCount: null }), null);
  assert.equal(sellfoxColumnValue(config[0], { ratingCount: 0 }), 0);
  assert.equal(sellfoxColumnValue(config[0], { ratingCount: 128 }), 128);
  assert.equal(visibleColumnCsv(config, [{ ratingCount: null }, { ratingCount: 0 }, { ratingCount: 128 }]).trim(), '"评论数"\r\n""\r\n0\r\n128');
  assert.equal(visibleColumns("ads", ["rating"])[0].unavailable, undefined);
  for (const domain of ["sales", "performance"] as const) {
    assert.doesNotMatch(workbenchReadSql(domain, query, scope).text, /ratingCount/);
  }
});

test("listings expose optional numeric purchaseCost from the current snapshot without losing null or zero", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  const scope = { organizationId: "org", workspaceId: "ws" };
  for (const exporting of [false, true]) {
    const sql = workbenchReadSql("listings", query, scope, exporting);
    assertListingProjection(sql.text);
  }
  const config = visibleColumns("listings", ["purchaseCost"]);
  assert.equal(config.length, 1);
  assert.equal(config[0].labelZh, "采购成本");
  assert.equal(config[0].unavailable, undefined);
  assert.equal(config[0].numeric, true);
  assert.equal(config[0].defaultVisible, false);
  assert.equal(config[0].requiresField, "Listing 当前快照 payload.purchaseCost");
  assert.ok(!defaultVisibleColumnKeys("listings").includes("purchaseCost"));
  assert.deepEqual(visibleColumns("listings", ["parentAsin", "purchaseCost", "bsrRank"]).map(c => c.key), ["bsrRank", "purchaseCost", "parentAsin"]);
  assert.equal(sellfoxColumnValue(config[0], { purchaseCost: null }), null);
  assert.equal(sellfoxColumnValue(config[0], { purchaseCost: 0 }), 0);
  assert.equal(sellfoxColumnValue(config[0], { purchaseCost: 12.5 }), 12.5);
  assert.equal(visibleColumnCsv(config, [{ purchaseCost: null }, { purchaseCost: 0 }, { purchaseCost: 12.5 }]).trim(), '"采购成本"\r\n""\r\n0\r\n12.5');
  for (const domain of ["ads", "sales", "performance"]) assert.deepEqual(visibleColumns(domain, ["purchaseCost"]), []);
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    for (const exporting of [false, true]) assert.doesNotMatch(workbenchReadSql(domain, query, scope, exporting).text, /purchaseCost/);
  }
});

for (const [key, label] of [["fbaFees", "FBA费用"], ["referralFee", "佣金"], ["totalFee", "总费用"], ["headTripCost", "头程"]]) {
  test(`listings expose optional numeric ${key} from the current snapshot without losing null or zero`, () => {
    const query = sellfoxBrowseQuery(new URL("http://localhost/"));
    const scope = { organizationId: "org", workspaceId: "ws" };
    for (const exporting of [false, true]) {
      const sql = workbenchReadSql("listings", query, scope, exporting);
      assertListingProjection(sql.text);
    }
    const config = visibleColumns("listings", [key]);
    assert.equal(config.length, 1);
    assert.equal(config[0].labelZh, label);
    assert.equal(config[0].unavailable, undefined);
    assert.equal(config[0].numeric, true);
    assert.equal(config[0].defaultVisible, false);
    assert.equal(config[0].requiresField, `Listing 当前快照 payload.${key}`);
    assert.ok(!defaultVisibleColumnKeys("listings").includes(key));
    assert.equal(sellfoxColumnValue(config[0], { [key]: null }), null);
    assert.equal(sellfoxColumnValue(config[0], { [key]: 0 }), 0);
    assert.equal(sellfoxColumnValue(config[0], { [key]: 9.68 }), 9.68);
    assert.equal(visibleColumnCsv(config, [{ [key]: null }, { [key]: 0 }, { [key]: 9.68 }]).trim(), `"${label}"\r\n""\r\n0\r\n9.68`);
    for (const domain of ["ads", "sales", "performance"]) assert.deepEqual(visibleColumns(domain, [key]), []);
    for (const domain of ["sales", "performance", "ads_report"] as const) {
      for (const exporting of [false, true]) assert.ok(!workbenchReadSql(domain, query, scope, exporting).text.includes(key));
    }
  });
}

test("listing fee columns follow purchaseCost and precede parentAsin in configured order", () => {
  assert.deepEqual(visibleColumns("listings", ["parentAsin", "headTripCost", "totalFee", "referralFee", "fbaFees", "purchaseCost"]).map(c => c.key),
    ["purchaseCost", "fbaFees", "referralFee", "totalFee", "headTripCost", "parentAsin"]);
});

test("listing default Buy Box and optional replenishment and profitability columns stay after headTripCost and before parentAsin", () => {
  const keys = ["buyBoxWinner", "reservedQty", "shippingPrice", "profitPrice", "profitRate"];
  assert.deepEqual(visibleColumns("listings", ["profitRate", "parentAsin", "reservedQty", "headTripCost", "profitPrice", "buyBoxWinner", "shippingPrice"]).map(c => c.key), ["headTripCost", ...keys, "parentAsin"]);
  for (const [key, label, numeric] of [["buyBoxWinner", "Buy Box", undefined], ["reservedQty", "预留", true], ["shippingPrice", "运费", true], ["profitPrice", "预估利润", true], ["profitRate", "利润率", true]] as const) {
    const config = visibleColumns("listings", [key]);
    assert.equal(config[0].labelZh, label);
    assert.equal(config[0].numeric, numeric);
    assert.equal(config[0].unavailable, undefined);
    assert.equal(config[0].defaultVisible, key === "buyBoxWinner");
    assert.equal(config[0].requiresField, `Listing 当前快照 payload.${key}${key === "buyBoxWinner" ? "（boolean→是/否）" : ""}`);
    assert.equal(defaultVisibleColumnKeys("listings").includes(key), key === "buyBoxWinner");
    for (const domain of [...(key === "buyBoxWinner" ? [] : ["ads"]), "sales", ...(key === "shippingPrice" ? [] : ["performance"])]) assert.deepEqual(visibleColumns(domain, [key]), []);
  }
});

test("listing-only columns extract Listing payload values without altering performance shippingPrice", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  const scope = { organizationId: "org", workspaceId: "ws" };
  for (const exporting of [false, true]) {
    const listingSql = workbenchReadSql("listings", query, scope, exporting).text;
    assertListingProjection(listingSql);
    const performanceSql = workbenchReadSql("performance", query, scope, exporting).text;
    assert.ok(performanceSql.includes('s."shippingPrice"'));
    assert.doesNotMatch(performanceSql, /reservedQty|profitPrice|profitRate/);
    assert.doesNotMatch(performanceSql.slice(performanceSql.indexOf("base AS")), /buyBoxWinner/);
    assert.doesNotMatch(performanceSql, /[ps]\.payload->>'shippingPrice'|shipCost/);
    for (const domain of ["ads_report", "sales"] as const) {
      const sql = workbenchReadSql(domain, query, scope, exporting).text;
      assert.doesNotMatch(sql, /reservedQty|shippingPrice|shipCost|profitPrice|profitRate/);
      if (domain === "sales") assert.doesNotMatch(sql.slice(sql.indexOf("base AS")), /buyBoxWinner/);
    }
  }
});

for (const [key, label] of [["reservedQty", "预留"], ["shippingPrice", "运费"], ["profitPrice", "预估利润"], ["profitRate", "利润率"]]) {
  test(`listing ${key} preserves null, missing, zero and raw numeric values`, () => {
    const config = visibleColumns("listings", [key]);
    const values = [null, 0, 0.25, ...(key === "profitPrice" ? [-0.25, -9.66] : [])];
    for (const value of values) assert.equal(sellfoxColumnValue(config[0], { [key]: value }), value);
    assert.equal(sellfoxColumnValue(config[0], {}), undefined);
    assert.equal(visibleColumnCsv(config, [...values.map(value => ({ [key]: value })), {}]).trim(),
      `"${label}"\r\n${values.map(value => value === null ? '""' : String(value)).join("\r\n")}\r\n""`);
  });
}

test("Buy Box boolean labels remain text in the UI and CSV", () => {
  const config = visibleColumns("listings", ["buyBoxWinner"]);
  assert.equal(sellfoxColumnValue(config[0], { buyBoxWinner: "是" }), "是");
  assert.equal(sellfoxColumnValue(config[0], { buyBoxWinner: "否" }), "否");
  assert.equal(sellfoxColumnValue(config[0], { buyBoxWinner: null }), null);
  assert.equal(sellfoxColumnValue(config[0], {}), undefined);
  assert.equal(visibleColumnCsv(config, [{ buyBoxWinner: "是" }, { buyBoxWinner: "否" }, { buyBoxWinner: null }, {}]).trim(), '"Buy Box"\r\n"是"\r\n"否"\r\n""\r\n""');
});

test("selected Listing-only numeric columns export null, zero, decimals and negative profit in CSV and XLSX", async () => {
  const keys = ["buyBoxWinner", "reservedQty", "shippingPrice", "profitPrice", "profitRate"];
  const labels = ["Buy Box", "预留", "运费", "预估利润", "利润率"];
  const rows = [
    Object.fromEntries(keys.map(key => [key, null])),
    { buyBoxWinner: "否", reservedQty: 0, shippingPrice: 0, profitPrice: 0, profitRate: 0 },
    { buyBoxWinner: "是", reservedQty: 1, shippingPrice: 0.25, profitPrice: -0.25, profitRate: 0.0 },
    { buyBoxWinner: null, reservedQty: 13, shippingPrice: 9.68, profitPrice: -9.66, profitRate: 0.125 },
    {},
  ];
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows, total: rows.length, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?column=profitRate&column=buyBoxWinner&column=profitPrice&column=shippingPrice&column=reservedQty&format=csv");
  const scope = { organizationId: "org", workspaceId: "ws" };
  try {
    const csv = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    assert.equal((await csv.text()).trim(), '"Buy Box","预留","运费","预估利润","利润率"\r\n"","","","",""\r\n"否",0,0,0,0\r\n"是",1,0.25,-0.25,0\r\n"",13,9.68,-9.66,0.125\r\n"","","","",""');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.columnCount, keys.length);
    assert.deepEqual(keys.map((_, index) => sheet.getRow(1).getCell(index + 1).value), labels);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      assert.deepEqual(keys.map((_, index) => sheet.getRow(rowIndex + 2).getCell(index + 1).value), keys.map(key => (rows[rowIndex] as Record<string, unknown>)[key] ?? null));
    }
  } finally { globals.prisma = previous; }
});

test("selected listing fees export null, zero and decimals in CSV and XLSX", async () => {
  const keys = ["fbaFees", "referralFee", "totalFee", "headTripCost"];
  const labels = ["FBA费用", "佣金", "总费用", "头程"];
  const decimals = [9.68, 4.95, 14.63, 9.24];
  const rows = [keys.map(() => null), keys.map(() => 0), decimals].map(values => Object.fromEntries(keys.map((key, index) => [key, values[index]])));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows, total: 3, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?column=headTripCost&column=totalFee&column=referralFee&column=fbaFees&format=csv");
  const scope = { organizationId: "org", workspaceId: "ws" };
  try {
    const csv = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    assert.equal((await csv.text()).trim(), '"FBA费用","佣金","总费用","头程"\r\n"","","",""\r\n0,0,0,0\r\n9.68,4.95,14.63,9.24');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.columnCount, 4);
    for (let index = 0; index < keys.length; index++) {
      assert.equal(sheet.getRow(1).getCell(index + 1).value, labels[index]);
      assert.equal(sheet.getRow(2).getCell(index + 1).value, null);
      assert.equal(sheet.getRow(3).getCell(index + 1).value, 0);
      assert.equal(sheet.getRow(4).getCell(index + 1).value, decimals[index]);
    }
  } finally { globals.prisma = previous; }
});

test("selected listing purchaseCost exports null, zero and decimals in CSV and XLSX", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [{ purchaseCost: null }, { purchaseCost: 0 }, { purchaseCost: 12.5 }], total: 3, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?column=purchaseCost&format=csv");
  const scope = { organizationId: "org", workspaceId: "ws" };
  try {
    const csv = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    assert.equal((await csv.text()).trim(), '"采购成本"\r\n""\r\n0\r\n12.5');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.columnCount, 1);
    assert.equal(sheet.getRow(1).getCell(1).value, "采购成本");
    assert.equal(sheet.getRow(2).getCell(1).value, null);
    assert.equal(sheet.getRow(3).getCell(1).value, 0);
    assert.equal(sheet.getRow(4).getCell(1).value, 12.5);
  } finally { globals.prisma = previous; }
});

test("listings flatten current productLabelList into an optional productTags column and CSV", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  const scope = { organizationId: "org", workspaceId: "ws" };
  const sql = workbenchReadSql("listings", query, scope);
  assertListingProjection(sql.text);
  const config = visibleColumns("listings", ["productTags"]);
  assert.equal(config.length, 1);
  assert.equal(config[0].unavailable, undefined);
  assert.equal(config[0].defaultVisible, false);
  assert.match(config[0].requiresField!, /productLabelList\[\]\.labelDetailList\[\]\.labelName/);
  assert.ok(!defaultVisibleColumnKeys("listings").includes("productTags"));
  const productTags = "1-3年产品、重点产品";
  assert.equal(sellfoxColumnValue(config[0], { productTags }), productTags);
  assert.equal(visibleColumnCsv(config, [{ productTags }, { productTags: null }]).trim(), `"产品标签"\r\n"${productTags}"\r\n""`);
  assert.equal(visibleColumns("ads", ["productTags"])[0].unavailable, undefined);
  assert.match(workbenchReadSql("ads_report", query, scope).text, /l\."productTags" AS "listingProductTags"/);
  for (const domain of ["sales", "performance"] as const) {
    assert.doesNotMatch(workbenchReadSql(domain, query, scope, true).text, domain === "sales" ? /productLabelList|productTagNames/ : /productLabelList|productTags/);
  }
});

test("listings default-show openDate as text from the current snapshot and preserve it in CSV", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  const scope = { organizationId: "org", workspaceId: "ws" };
  const sql = workbenchReadSql("listings", query, scope);
  assertListingProjection(sql.text);
  const sourceKeys = columns.listings.map(c => c.key);
  assert.deepEqual(sourceKeys.slice(sourceKeys.indexOf("productTags"), sourceKeys.indexOf("firstSaleDate") + 1), ["productTags", "openDate", "firstSaleDate"]);
  const config = visibleColumns("listings", ["openDate"]);
  assert.equal(config.length, 1);
  assert.equal(config[0].labelZh, "上架时间");
  assert.equal(config[0].unavailable, undefined);
  assert.equal(config[0].numeric, undefined);
  assert.equal(config[0].defaultVisible, true);
  assert.equal(config[0].requiresField, "Listing 当前快照 payload.openDate");
  assert.ok(defaultVisibleColumnKeys("listings").includes("openDate"));
  assert.equal(sellfoxColumnValue(config[0], { openDate: null }), null);
  assert.equal(sellfoxColumnValue(config[0], { openDate: "2024-01-15" }), "2024-01-15");
  assert.equal(visibleColumnCsv(config, [{ openDate: null }, { openDate: "2024-01-15" }]).trim(), '"上架时间"\r\n""\r\n"2024-01-15"');
  assert.deepEqual(visibleColumns("ads", ["openDate"]), []);
  for (const domain of ["ads_report", "sales", "performance"] as const) {
    for (const exporting of [false, true]) assert.doesNotMatch(workbenchReadSql(domain, query, scope, exporting).text, /openDate/);
  }
});

test("listings expose optional text firstSaleDate from the current snapshot and preserve it in CSV", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  const scope = { organizationId: "org", workspaceId: "ws" };
  for (const exporting of [false, true]) {
    const sql = workbenchReadSql("listings", query, scope, exporting);
    assertListingProjection(sql.text);
  }
  const config = visibleColumns("listings", ["firstSaleDate"]);
  assert.equal(config.length, 1);
  assert.equal(config[0].labelZh, "首次售出");
  assert.equal(config[0].unavailable, undefined);
  assert.equal(config[0].numeric, undefined);
  assert.equal(config[0].defaultVisible, false);
  assert.equal(config[0].requiresField, "Listing 当前快照 payload.firstSaleDate（空则 firstOrderDate；123 上 firstSaleDate 常空）");
  assert.ok(!defaultVisibleColumnKeys("listings").includes("firstSaleDate"));
  assert.deepEqual(visibleColumns("listings", ["bsrRank", "firstSaleDate", "openDate"]).map(c => c.key), ["openDate", "firstSaleDate", "bsrRank"]);
  assert.equal(sellfoxColumnValue(config[0], { firstSaleDate: null, firstOrderDate: "2024-01-14" }), null);
  assert.equal(sellfoxColumnValue(config[0], { firstSaleDate: "2024-01-15" }), "2024-01-15");
  assert.equal(visibleColumnCsv(config, [{ firstSaleDate: null }, { firstSaleDate: "2024-01-15" }, { firstSaleDate: "" }]).trim(), '"首次售出"\r\n""\r\n"2024-01-15"\r\n""');
  for (const domain of ["ads", "sales", "performance"]) assert.deepEqual(visibleColumns(domain, ["firstSaleDate"]), []);
  for (const domain of ["ads_report", "sales", "performance"] as const) {
    for (const exporting of [false, true]) assert.doesNotMatch(workbenchReadSql(domain, query, scope, exporting).text, /firstSaleDate/);
  }
});

test("listings null exact BSR sentinel 9999999 after numeric cast, preferring bigCategory then array order", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  const scope = { organizationId: "org", workspaceId: "ws" };
  for (const exporting of [false, true]) {
    const sql = workbenchReadSql("listings", query, scope, exporting);
    assertListingProjection(sql.text);
  }
  const config = visibleColumns("listings", ["bsrRank"]);
  assert.equal(config.length, 1);
  assert.equal(config[0].labelZh, "BSR");
  assert.equal(config[0].unavailable, undefined);
  assert.equal(config[0].numeric, true);
  assert.equal(config[0].defaultVisible, false);
  assert.equal(config[0].requiresField, "Listing 当前快照 payload.bsrRank[].rank（优先 bigCategory）");
  assert.ok(!defaultVisibleColumnKeys("listings").includes("bsrRank"));
  assert.deepEqual(visibleColumns("listings", ["ratingCount", "openDate", "bsrRank"]).map(c => c.key), ["ratingCount", "openDate", "bsrRank"]);
  assert.equal(sellfoxColumnValue(config[0], { bsrRank: null }), null);
  assert.equal(sellfoxColumnValue(config[0], { bsrRank: 0 }), 0);
  assert.equal(sellfoxColumnValue(config[0], { bsrRank: 12345 }), 12345);
  assert.equal(visibleColumnCsv(config, [{ bsrRank: null }, { bsrRank: 0 }, { bsrRank: 12345 }]).trim(), '"BSR"\r\n""\r\n0\r\n12345');
  const realRanks = [1381, 16396, 47231, 999999, 9999998];
  for (const bsrRank of realRanks) assert.equal(sellfoxColumnValue(config[0], { bsrRank }), bsrRank);
  assert.equal(visibleColumnCsv(config, realRanks.map(bsrRank => ({ bsrRank }))).trim(), '"BSR"\r\n1381\r\n16396\r\n47231\r\n999999\r\n9999998');
  for (const domain of ["ads", "sales", "performance"]) assert.deepEqual(visibleColumns(domain, ["bsrRank"]), []);
  for (const domain of ["ads_report", "sales", "performance"] as const) {
    for (const exporting of [false, true]) assert.doesNotMatch(workbenchReadSql(domain, query, scope, exporting).text, /bsrRank/);
  }
});

test("selected listing BSR exports null, zero and numbers in CSV and XLSX", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [{ bsrRank: null }, { bsrRank: 0 }, { bsrRank: 12345 }], total: 3, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?column=bsrRank&format=csv");
  const scope = { organizationId: "org", workspaceId: "ws" };
  try {
    const csv = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    assert.equal((await csv.text()).trim(), '"BSR"\r\n""\r\n0\r\n12345');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.columnCount, 1);
    assert.equal(sheet.getRow(1).getCell(1).value, "BSR");
    assert.equal(sheet.getRow(2).getCell(1).value, null);
    assert.equal(sheet.getRow(3).getCell(1).value, 0);
    assert.equal(sheet.getRow(4).getCell(1).value, 12345);
  } finally { globals.prisma = previous; }
});

test("listing openDate exports as unchanged text or an empty XLSX cell", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [{ openDate: "2024-01-15" }, { openDate: null }], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?column=openDate&format=xlsx");
  try {
    const response = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), { organizationId: "org", workspaceId: "ws" }, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.getRow(1).getCell(1).value, "上架时间");
    assert.equal(sheet.getRow(2).getCell(1).value, "2024-01-15");
    assert.equal(sheet.getRow(3).getCell(1).value, null);
  } finally { globals.prisma = previous; }
});

test("selected listing firstSaleDate exports as unchanged text or an empty CSV/XLSX cell", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [{ firstSaleDate: "2024-01-15" }, { firstSaleDate: null, firstOrderDate: "2024-01-14" }], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?column=firstSaleDate&format=csv");
  const scope = { organizationId: "org", workspaceId: "ws" };
  try {
    const csv = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    assert.equal((await csv.text()).trim(), '"首次售出"\r\n"2024-01-15"\r\n""');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("listings", sellfoxBrowseQuery(url), scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.columnCount, 1);
    assert.equal(sheet.getRow(1).getCell(1).value, "首次售出");
    assert.equal(sheet.getRow(2).getCell(1).value, "2024-01-15");
    assert.equal(sheet.getRow(3).getCell(1).value, null);
  } finally { globals.prisma = previous; }
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
    assert.match(text, domain === "sales" ? /min\(NULLIF\("listingMainImage",''\)\) AS "mainImage"/ : /min\(NULLIF\("mainImageCandidate",''\)\) AS "mainImage"/);
    assert.doesNotMatch(text, /count\((?:DISTINCT )?"(?:listingMainImage|mainImage)"\)/);
    if (domain === "sales") assert.match(text, /listingMainImage/);
  }
  assert.doesNotMatch(workbenchReadSql("sales", query, { organizationId: "org", workspaceId: "ws" }).text, /s\."imageUrl"/);
});

test("performance optional costs and refunds read typed columns and sum by entity and currency without changing refund rates", () => {
  const keys = ["commodityCost", "shippingPrice", "taxPrice", "headTripPrice", "avgPurchaseCost", "amazonCommissionPrice", "refundPrice", "refundNum"];
  const config = visibleColumns("performance", keys);
  assert.deepEqual(config.map(c => [c.key, c.labelZh, c.numeric, c.defaultVisible, c.unavailable]), [
    ["commodityCost", "商品成本", true, false, undefined], ["shippingPrice", "运费", true, false, undefined], ["taxPrice", "税费", true, false, undefined],
    ["headTripPrice", "头程", true, false, undefined], ["avgPurchaseCost", "采购成本", true, false, undefined], ["amazonCommissionPrice", "亚马逊佣金", true, false, undefined],
    ["refundPrice", "退款金额", true, false, undefined], ["refundNum", "退款量", true, false, undefined],
  ]);
  assert.deepEqual(config.map(c => captions[c.key]), ["商品成本", "运费", "税费", "头程", "采购成本", "亚马逊佣金", "退款金额", "退款量"]);
  assert.deepEqual(defaultVisibleColumnKeys("performance"), ["image", "identity", "name", "analysis", "parentAsin", "sku", "grossProfit", "grossProfitRate", "netProfitRate", "saleRevenue", "netRevenue", "orderNum", "fulfillable", "saleQuantity", "evaluationSaleNum", "channelSaleNum", "promotionDiscount", "giftWrapFee", "adCost", "currency", "salesperson"]);
  for (const key of ["headTripPrice", "avgPurchaseCost", "amazonCommissionPrice"]) {
    assert.deepEqual(visibleColumns("listings", [key]), []);
    assert.deepEqual(visibleColumns("sales", [key]), []);
    for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=${sortOrder}`), "performance");
      assert.ok(workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }).text.includes(`ORDER BY "${key}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
    }
  }
  for (const c of config.slice(0, 6)) assert.equal(c.requiresField, `销售利润 payload.${c.key}`);
  for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer"]) {
    assert.ok(defaultVisibleColumnKeys("performance", dimension).every(key => !keys.includes(key)));
    for (const onlySettle of [false, true]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&from=2026-10-24&to=2026-10-25&onlySettle=${Number(onlySettle)}`));
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
        for (const key of keys) {
          assert.ok(sql.text.includes(`s."${key}"`));
          assert.ok(!sql.text.includes(`s.payload->>'${key}'`));
          assert.equal(sql.text.split(`COALESCE(sum("${key}"),0)::float AS "${key}"`).length - 1, 2);
          assert.ok(!sql.text.includes(`count("${key}")`));
        }
        assert.doesNotMatch(sql.text, /payload|headTripCost|purchaseCost|referralFee/);
        assert.ok(sql.values.includes(onlySettle));
        assert.match(sql.text, /FROM filtered GROUP BY currency/);
        assert.match(sql.text, /CASE WHEN count\(\*\)=1 THEN min\("refundRate"\) END AS "refundRate"/);
      }
    }
  }
});

test("optional cost and refund columns export numeric values in CSV and XLSX", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [{ commodityCost: 8.25, shippingPrice: 3.5, taxPrice: -0.5, headTripPrice: 6.5, avgPurchaseCost: 7, amazonCommissionPrice: -8, refundPrice: 12.5, refundNum: 2 }, { commodityCost: 0, shippingPrice: 0, taxPrice: 0, headTripPrice: 0, avgPurchaseCost: 0, amazonCommissionPrice: 0, refundPrice: 0, refundNum: 0 }], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?reportDate=2026-10-25&column=commodityCost&column=shippingPrice&column=taxPrice&column=headTripPrice&column=avgPurchaseCost&column=amazonCommissionPrice&column=refundPrice&column=refundNum");
  const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
  try {
    assert.equal((await (await sellfoxWorkbenchExport("performance", query, scope, url)).text()).trim(), '"商品成本","运费","税费","头程","采购成本","亚马逊佣金","退款金额","退款量"\r\n8.25,3.5,-0.5,6.5,7,-8,12.5,2\r\n0,0,0,0,0,0,0,0');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(col => sheet.getRow(1).getCell(col).value), ["商品成本", "运费", "税费", "头程", "采购成本", "亚马逊佣金", "退款金额", "退款量"]);
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(col => sheet.getRow(2).getCell(col).value), [8.25, 3.5, -0.5, 6.5, 7, -8, 12.5, 2]);
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(col => sheet.getRow(3).getCell(col).value), [0, 0, 0, 0, 0, 0, 0, 0]);
  } finally { globals.prisma = previous; }
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

test("fulfillment uses scoped current Listing and filters members before sales/profit/ads rollups and totals", () => {
  const scope = { organizationId: "org-fulfillment", workspaceId: "ws-fulfillment" };
  for (const domain of ["sales", "performance", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
    for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer", ...(domain === "sales" ? ["spu"] : [])]) {
      for (const fulfillment of ["AFN", "MFN"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&fulfillment=${fulfillment}&from=2026-10-25&to=2026-10-25&onlySettle=1`));
        for (const exporting of [false, true]) {
          const sql = workbenchReadSql(domain, query, scope, exporting);
          if (domain === "listings") { assertListingProjection(sql.text); assert.match(sql.text, /s.fulfillment=/); continue; }
          assert.ok(sql.values.includes(fulfillment));
          assert.match(sql.text, /l.fulfillment/); assert.doesNotMatch(sql.text, /p\.payload|switchFulfillmentTo/);
          const base = sql.text.slice(sql.text.indexOf("base AS"), sql.text.indexOf(domain === "sales" ? "days AS" : "grouped AS"));
          assert.match(base, /WHERE [\s\S]* AND l.fulfillment=\$\d+\)/);
          assert.doesNotMatch(sql.text, /JOIN "SellfoxListingSnapshot"|p\.payload/);
          assert.ok(sql.values.includes(scope.organizationId) && sql.values.includes(scope.workspaceId));
          {
            assert.match(base, /candidate\."storeId"=s\."storeId"/);
            assert.match(base, /ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1/);
            // Fact reads use typed columns, never payload scalars.
            assert.deepEqual([...base.matchAll(/s\.payload->>'([^']+)'/g)].map(match => match[1]), []);
            assert.doesNotMatch(base, /s\.payload(?:\s|,)/);
          }
        }
      }
    }
    const all = workbenchReadSql(domain, sellfoxBrowseQuery(new URL("http://localhost/")), scope);
    assert.doesNotMatch(all.text, /AND l.fulfillment=/);
  }
  const config = visibleColumns("listings", ["fulfillment"]);
  assert.equal(config[0].labelZh, "发货方式");
  assert.equal(config[0].unavailable, undefined);
  assert.equal(defaultVisibleColumnKeys("listings").includes("fulfillment"), true);
  assert.equal(visibleColumnCsv(config, [{ fulfillment: "AFN" }, { fulfillment: "MFN" }, { fulfillment: null }]).trim(), '"发货方式"\r\n"AFN"\r\n"MFN"\r\n""');
});


test("Buy Box filters scoped current Listing boolean members before rollups, totals, pagination and export", () => {
  const scope = { organizationId: "org-buybox", workspaceId: "ws-buybox" };
  for (const domain of ["sales", "performance", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
    for (const dimension of domain.startsWith("ads_") ? ["asin"] : ["asin", "parentAsin", "msku", "sku", "store", "developer", ...(domain === "sales" ? ["spu"] : [])]) {
      for (const buyBox of ["yes", "no"] as const) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&buyBox=${buyBox}&from=2026-10-25&to=2026-10-25&onlySettle=1&fulfillment=AFN&productTag=tag`));
        for (const exporting of [false, true]) {
          const sql = workbenchReadSql(domain, query, scope, exporting);
          if (domain === "listings") { assertListingProjection(sql.text); assert.match(sql.text, /s\."buyBoxWinner"=/); assert.ok(sql.values.includes(buyBox === "yes" ? "是" : "否")); continue; }
          assert.match(sql.text, /l\."buyBoxWinner"/); assert.doesNotMatch(sql.text, /p\.payload/);
          assert.doesNotMatch(sql.text, /p.payload->>'buyBoxWinner'|buyBoxWinner[^,;]*::float/);
          const base = sql.text.slice(sql.text.indexOf("base AS"), sql.text.indexOf(domain === "sales" ? "days AS" : "grouped AS"));
          const parameter = base.match(/WHERE [\s\S]* AND l\."buyBoxWinner"=\$(\d+)/);
          assert.ok(parameter);
          assert.equal(sql.values[Number(parameter[1]) - 1], buyBox === "yes" ? "是" : "否");
          assert.match(base, /AND l.fulfillment=/); assert.match(base, /AND l\."matchesProductTag"/);
          assert.doesNotMatch(sql.text, /JOIN "SellfoxListingSnapshot"|p\.payload/);
          assert.match(sql.text, /WHERE l\."organizationId"=[\s\S]*l\."workspaceId"=/);
          assert.ok(sql.values.includes(scope.organizationId) && sql.values.includes(scope.workspaceId));
          {
            assert.match(base, /LEFT JOIN LATERAL \(SELECT candidate\.\* FROM listing candidate WHERE candidate\."storeId"=s\."storeId"/);
            assert.match(base, /ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1\) l ON TRUE/);
            assert.deepEqual([...base.matchAll(/s\.payload->>'([^']+)'/g)].map(match => match[1]), []);
          }
        }
      }
    }
    for (const exporting of [false, true]) {
      const all = workbenchReadSql(domain, sellfoxBrowseQuery(new URL("http://localhost/?buyBox=")), scope, exporting);
      assert.doesNotMatch(all.text, /AND l\."buyBoxWinner"=/);
    }
  }
});

test("untagged sales and performance browse keep label expansion out of the main Listing CTE", () => {
  const scope = { organizationId: "org-tag", workspaceId: "ws-tag" };
  const query = sellfoxBrowseQuery(new URL("http://localhost/"));
  for (const domain of ["sales", "performance"] as const) {
    const sql = workbenchReadSql(domain, query, scope);
    const listing = sql.text.slice(0, sql.text.indexOf("base AS ("));
    assert.doesNotMatch(listing, /productLabelList|labelDetailList|productTagNames|product_labels/);
    assert.match(sql.text, /unnest\(l\."productTagNames"\)/); assert.doesNotMatch(sql.text, /p\.payload|jsonb_array_elements/);
    assert.match(sql.text, /jsonb_build_object\('productTags',[\s\S]*SELECT DISTINCT tag\."labelName" FROM sellfox_listing_current l/);
    assert.doesNotMatch(workbenchReadSql(domain, query, scope, true).text, /productLabelList|AS facets/);
  }
});

test("productTag exact membership filters current Listing members before aggregation with independent scoped facets", () => {
  const scope = { organizationId: "org-tag", workspaceId: "ws-tag" };
  for (const domain of ["sales", "performance", "listings"] as const) {
    for (const dimension of ["msku", "asin", "parentAsin", "store", "developer", ...(domain === "sales" ? ["spu"] : [])]) {
      for (const tag of ["1年以内产品", "1年以内产品延长", "标签、含分隔符", "%' OR TRUE--"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${new URLSearchParams({ productTag: tag, dimension, fulfillment: "AFN", site: "US", shopExternalId: "shop-tag" })}`));
        for (const exporting of [false, true]) {
          const sql = workbenchReadSql(domain, query, scope, exporting);
          if (domain === "listings") { assertListingProjection(sql.text); assert.match(sql.text, /s\."productTagNames" @> ARRAY\[/); assert.ok(sql.values.includes(tag)); continue; }
          const listing = sql.text.slice(0, sql.text.indexOf("base AS ("));
          const base = sql.text.slice(sql.text.indexOf("base AS ("), sql.text.indexOf(domain === "sales" ? "days AS (" : "grouped AS ("));
          assert.match(listing, /l\."productTagNames" @> ARRAY\[\$\d+\]::text\[\] AS "matchesProductTag"/);
          assert.match(base, /AND l\."matchesProductTag"\)/);
          assert.doesNotMatch(sql.text, /p\.payload|jsonb_array_elements|product_labels/);
          assert.ok(sql.values.includes(tag));
          assert.ok(sql.values.includes(scope.organizationId)); assert.ok(sql.values.includes(scope.workspaceId));
          assert.ok(!sql.values.includes(`%${tag}%`));
          assert.doesNotMatch(base, /"productTags" (?:I?LIKE|=)/);
          assert.match(base, /l.fulfillment=/);
          if (["sales", "performance"].includes(domain)) {
            const candidate = base.slice(base.indexOf("LEFT JOIN LATERAL"), base.indexOf("LIMIT 1) l ON TRUE"));
            assert.match(candidate, /candidate.msku=s.msku/);
            assert.doesNotMatch(candidate, /matchesProductTag|labelName|productLabelList/);
            assert.match(base, /LIMIT 1\) l ON TRUE WHERE [\s\S]*l\."matchesProductTag"/);
          }
          if (exporting) assert.doesNotMatch(sql.text, /AS facets/);
          else {
            const facets = sql.text.slice(sql.text.indexOf("jsonb_build_object('productTags'"));
            assert.match(facets, /SELECT DISTINCT tag\."labelName" FROM sellfox_listing_current l/);
            assert.doesNotMatch(facets, /payload|JOIN "SellfoxListingSnapshot"/);
            assert.match(facets, /st\."organizationId"=\$\d+ AND st\."workspaceId"=\$\d+/);
            assert.match(facets, /WHERE l\."organizationId"=\$\d+ AND l\."workspaceId"=\$\d+/);
            assert.match(facets, /CROSS JOIN LATERAL unnest\(l\."productTagNames"\) tag\("labelName"\)/);
            assert.match(facets, /ORDER BY tag\."labelName"/);
            assert.match(facets, /st\."externalId" IN/); assert.match(facets, /st.marketplace=/);
            assert.doesNotMatch(facets, /tag\."labelName"=|ILIKE|FROM listing l|matchesProductTag|status|fulfillment/);
          }
        }
      }
    }
    assert.doesNotMatch(workbenchReadSql(domain, sellfoxBrowseQuery(new URL("http://localhost/")), scope).text, /matchesProductTag/);
  }
  for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
    for (const exporting of [false, true]) {
      const ads = workbenchReadSql(domain, sellfoxBrowseQuery(new URL(`http://localhost/?${new URLSearchParams({ productTag: " 标签、完整 ", search: "needle", site: "US", shopExternalId: "shop", storeId: "store" })}`), domain), scope, exporting);
      assert.match(ads.text, /l\."productTagNames" @> ARRAY\[\$\d+\]::text\[\] AS "matchesProductTag"/);
      assert.ok(ads.values.includes("标签、完整")); assert.ok(!ads.values.includes("%标签、完整%"));
      const base = ads.text.slice(ads.text.indexOf("base AS ("), ads.text.indexOf("grouped AS ("));
      const candidate = base.slice(base.indexOf("LEFT JOIN LATERAL"), base.indexOf("LIMIT 1) l ON TRUE"));
      assert.doesNotMatch(candidate, /matchesProductTag|productTagNames/);
      assert.match(base, /LIMIT 1\) l ON TRUE WHERE [\s\S]*l\."matchesProductTag"/);
      if (exporting) assert.doesNotMatch(ads.text, /AS facets/);
      else {
        const facets = ads.text.slice(ads.text.indexOf("jsonb_build_object('productTags'"));
        assert.match(facets, /unnest\(l\."productTagNames"\)/);
        assert.match(facets, /l\."organizationId"=\$\d+ AND l\."workspaceId"=\$\d+/);
        assert.match(facets, /st\."externalId" IN/); assert.match(facets, /l\."storeId"=/); assert.match(facets, /st.marketplace=/);
        assert.match(facets, /'brands', ARRAY\(SELECT DISTINCT l.brand/);
        assert.doesNotMatch(facets, /salespersons|ILIKE|matchesProductTag|tag\."labelName"=/);
      }
    }
  }
});

test("brand exact match filters selected Listing members before rollup with independent scoped facets", () => {
  const scope = { organizationId: "org-brand", workspaceId: "ws-brand" };
  for (const domain of ["sales", "performance", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
    for (const dimension of domain.startsWith("ads_") ? ["asin"] : ["msku", "asin", "parentAsin", "sku", "store", "developer", "spu"]) {
      for (const brand of ["00123", "Goghost-乐器", "Nvaav", "%' OR TRUE--"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${new URLSearchParams({ brand: ` ${brand} `, dimension, productTag: "tag", fulfillment: "AFN", buyBox: "yes", search: "needle", status: "active", site: "US", shopExternalId: "shop-brand", storeId: "store-brand" })}`));
        for (const exporting of [false, true]) {
          const sql = workbenchReadSql(domain, query, scope, exporting);
          if (domain === "listings") { assertListingProjection(sql.text); assert.match(sql.text, /s.brand=/); assert.ok(sql.values.includes(brand)); continue; }
          const listing = sql.text.slice(0, sql.text.indexOf("base AS ("));
          const base = sql.text.slice(sql.text.indexOf("base AS ("), sql.text.indexOf(domain === "sales" ? "days AS (" : "grouped AS ("));
          assert.match(listing, /l.brand/); assert.doesNotMatch(listing, /payload|JOIN "SellfoxListingSnapshot"/);
          const parameter = base.match(/AND l.brand=\$(\d+)/);
          assert.ok(parameter); assert.equal(sql.values[Number(parameter[1]) - 1], brand);
          if (["sales", "performance"].includes(domain)) assert.doesNotMatch(sql.text, /amazonBrand/);
          assert.doesNotMatch(base.slice(base.indexOf(" WHERE ")), /amazonBrand/);
          assert.ok(!sql.values.includes(`%${brand}%`));
          assert.match(base, /l.fulfillment=/); assert.match(base, /l\."matchesProductTag"/);
          assert.match(base, /l\."buyBoxWinner"=/);
          {
            const candidate = base.slice(base.indexOf("LEFT JOIN LATERAL"), base.indexOf("LIMIT 1) l ON TRUE"));
            assert.match(candidate, /candidate.msku=s.msku[\s\S]*candidate.asin=s.asin/);
            assert.match(candidate, /ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id/);
            assert.doesNotMatch(candidate, /brand|matchesProductTag/);
            assert.match(base, /LIMIT 1\) l ON TRUE WHERE [\s\S]*AND l.brand=/);
          }
          if (exporting) assert.doesNotMatch(sql.text, /AS facets/);
          else {
            const facets = sql.text.slice(sql.text.indexOf("jsonb_build_object('productTags'"));
            assert.match(facets, /SELECT DISTINCT tag\."labelName"/);
            assert.match(facets, /'brands', ARRAY\(SELECT DISTINCT l.brand FROM sellfox_listing_current l/);
            const brands = facets.slice(facets.indexOf("'brands'"));
            assert.doesNotMatch(brands, /payload|JOIN "SellfoxListingSnapshot"/);
            assert.match(brands, /JOIN "SellfoxStore" st ON st.id=l\."storeId" AND st\."organizationId"=\$\d+ AND st\."workspaceId"=\$\d+/);
            assert.match(brands, /WHERE l\."organizationId"=\$\d+ AND l\."workspaceId"=\$\d+/);
            assert.match(brands, /st\."externalId" IN/); assert.match(brands, /st.marketplace=/); assert.match(brands, /l\."storeId"=/);
            assert.match(brands, /l.brand IS NOT NULL ORDER BY 1/);
            assert.doesNotMatch(facets, /l.brand=|matchesProductTag|ILIKE|status|fulfillment|buyBoxWinner|FROM listing l/);
          }
        }
      }
    }
    for (const brand of ["", "   "]) {
      for (const exporting of [false, true]) assert.doesNotMatch(workbenchReadSql(domain, sellfoxBrowseQuery(new URL(`http://localhost/?brand=${brand}`)), scope, exporting).text, /AND l.brand=/);
    }
  }
});

test("browse returns all dynamic tag and brand facets even for an empty result page without extra reads", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  let calls = 0;
  const facets = { productTags: ["1年以内产品", "新标签、完整名称"], brands: ["Goghost-乐器", "Nvaav"] };
  globals.prisma = { $queryRaw: async () => { calls++; return [{ rows: [], total: 0, totals: [], facets }]; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "performance", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
      const result = await readSellfoxWorkbench(domain, sellfoxBrowseQuery(new URL("http://localhost/?from=2026-10-25&to=2026-10-25&productTag=不存在")), { organizationId: "org", workspaceId: "ws" });
      assert.deepEqual(result.facets, facets); assert.deepEqual(result.rows, []);
    }
    assert.equal(calls, 9);
  } finally { globals.prisma = previous; }
});

test("targeting/search-term use their own views and stable identity while applying scoped typed search and ads quick filters", () => {
  for (const domain of ["ads_targeting", "ads_search_term"] as const) {
    const searchType = domain === "ads_targeting" ? "targetingId" : "searchTerm";
    const query = sellfoxBrowseQuery(new URL(`http://localhost/?from=2026-10-23&to=2026-10-24&adType=sb&quickFilter=clicksNoOrders&searchType=${searchType}&search=needle&exactMatch=1&shopExternalId=shop&site=US`));
    const sql = workbenchReadSql(domain, query, { organizationId: "org", workspaceId: "ws" });
    assert.match(sql.text, new RegExp(`FROM sellfox_${domain}_daily s`));
    assert.match(sql.text, /s\."organizationId"=\$\d+ AND s\."workspaceId"=\$\d+/);
    assert.match(sql.text, /s\."adType"=\$\d+/); assert.match(sql.text, /clicks>0 AND "adOrders"=0/);
    assert.match(sql.text, new RegExp(`lower\\(s\\."${searchType}"\\)=lower\\(\\$\\d+\\)`));
    assert.match(sql.text, /GROUP BY "storeId",currency,"adType","campaignId","adGroupId"/);
    assert.doesNotMatch(sql.text, /"productId"|s.sku/);
    assert.ok(sql.values.includes("needle")); assert.ok(sql.values.includes("sb")); assert.ok(sql.values.includes("shop"));
  }
});

test("workbench sorts the entire filtered aggregate before LIMIT/OFFSET with stable ties", () => {
  const scope = { organizationId: "sort-org", workspaceId: "sort-workspace" };
  const cases = [
    ["sales", "subtotal", '"subtotal"'], ["listings", "sales7", '"sales7"'],
    ["performance", "grossProfitRate", 'CASE WHEN "saleRevenue">0 THEN "grossProfit"/"saleRevenue" END'],
    ["ads_report", "cost", '"cost"'], ["ads_targeting", "targetingText", '"targetingText"'],
    ["ads_search_term", "searchTerm", '"searchTerm"'], ["ads_campaign", "campaignName", '"campaignName"'],
    ["ads_ad_group", "adGroupName", '"adGroupName"'], ["ads_placement", "placement", '"placement"'],
  ] as const;
  for (const [domain, sortBy, expression] of cases) for (const sortOrder of ["asc", "desc"]) {
    const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${sortBy}&sortOrder=${sortOrder}&page=3&pageSize=20&site=US&shopExternalId=shop-a&search=needle`), domain);
    for (const exporting of [false, true]) {
      const sql = workbenchReadSql(domain, query, scope, exporting);
      assert.ok(sql.text.replace(/\s+/g, " ").includes(`FROM filtered ORDER BY ${expression} ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
      const pagination = sql.text.match(/FROM filtered ORDER BY [\s\S]*?LIMIT \$(\d+) OFFSET \$(\d+)/)!;
      assert.equal(sql.values[Number(pagination[1]) - 1], exporting ? 10001 : 20);
      assert.equal(sql.values[Number(pagination[2]) - 1], exporting ? 0 : 40);
      for (const value of [scope.organizationId, scope.workspaceId, "US", "shop-a", "%needle%"]) assert.ok(sql.values.includes(value));
    }
  }
  const defaults = sellfoxBrowseQuery(new URL("http://localhost/"));
  assert.match(workbenchReadSql("sales", defaults, scope).text, /FROM filtered ORDER BY id LIMIT/);
  assert.throws(() => workbenchReadSql("sales", { ...defaults, sortBy: "cost" }, scope), /排序/);
  assert.throws(() => workbenchReadSql("sales", { ...defaults, sortBy: 'id";DROP TABLE' }, scope), /排序/);
  const store = { ...defaults, dimension: "store" as const, sortBy: "identity", sortOrder: "asc" as const };
  assert.match(workbenchReadSql("sales", store, scope).text, /FROM filtered ORDER BY name ASC NULLS LAST, id ASC LIMIT/);
});


test("unsupported profit SPU dimension still sorts by its fallback ASIN identity", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/?dimension=spu&sortBy=identity&sortOrder=asc"), "performance");
  assert.match(workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }).text, /FROM filtered ORDER BY "identity" ASC NULLS LAST, id ASC LIMIT/);
});


test("performance salesperson filters typed facts before aggregation and facets remain scoped; sales ignore it", () => {
  const query = sellfoxBrowseQuery(new URL("http://localhost/?from=2026-10-24&to=2026-10-25&salesperson=" + encodeURIComponent("温见清")));
  const scope = { organizationId: "org", workspaceId: "ws" };
  for (const exporting of [false, true]) {
    const sql = workbenchReadSql("performance", query, scope, exporting);
    assert.match(sql.text, /s\."userNameList" @> ARRAY\[\$\d+\]::text\[\]/);
    assert.ok(sql.text.indexOf('s."userNameList" @>') < sql.text.indexOf('grouped AS'));
    assert.ok(sql.values.includes("温见清")); assert.doesNotMatch(sql.text, /payload|developer.*userNameList/);
    assert.match(sql.text, /salesperson_names AS/);
    if (!exporting) { assert.match(sql.text, /'salespersons',ARRAY/); assert.match(sql.text, /unnest\(s\."userNameList"\)/); }
    else assert.doesNotMatch(sql.text, /AS facets/);
    const sales = workbenchReadSql("sales", query, scope, exporting);
    assert.doesNotMatch(sales.text, /userNameList|salesperson/); assert.ok(!sales.values.includes("温见清"));
  }
});


test("performance selected salesperson exports typed names in CSV and Excel with identical containment", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const names = ["温见清", "陈馨"];
  const url = new URL("http://localhost/?from=2026-10-24&to=2026-10-24&column=salesperson&salesperson=" + encodeURIComponent("温见清"));
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /s\."userNameList" @> ARRAY\[\$\d+\]::text\[\]/); assert.ok(sql.values.includes("温见清"));
    return [{ total: 2, totals: [], rows: [{ id: "named", userNameList: names }, { id: "empty", userNameList: [] }] }];
  } } as unknown as PrismaClient;
  try {
    const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
    const csv = await (await sellfoxWorkbenchExport("performance", query, scope, url)).text();
    assert.equal(csv.trim(), '"业务员"\r\n"温见清、陈馨"\r\n""');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs"); const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.getCell("A1").value, "业务员"); assert.equal(sheet.getCell("A2").value, names.join("、"));
    assert.ok(!sheet.getCell("A3").value);
  } finally { globals.prisma = previous; }
});

test("performance default CSV and Excel include salesperson names in product and rollup dimensions without column or layout selections", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ total: 2, totals: [], rows: [{ id: "named", userNameList: ["温见清", "陈馨"] }, { id: "empty", userNameList: [] }] }] } as unknown as PrismaClient;
  try {
    const { default: ExcelJS } = await import("exceljs");
    for (const dimension of ["asin", "msku", "sku", "parentAsin", "store", "developer", "spu"]) {
      const url = new URL(`http://localhost/?from=2026-10-24&to=2026-10-24&dimension=${dimension}`);
      const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
      const csv = await (await sellfoxWorkbenchExport("performance", query, scope, url)).text();
      const lines = csv.trim().split("\r\n");
      assert.ok(lines[0].endsWith(',"币种","业务员"'));
      assert.ok(lines[1].endsWith(',"温见清、陈馨"'));
      assert.ok(lines[2].endsWith(',""'));
      url.searchParams.set("format", "xlsx");
      const response = await sellfoxWorkbenchExport("performance", query, scope, url);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer());
      const sheet = book.worksheets[0], last = sheet.columnCount;
      assert.equal(sheet.getRow(1).getCell(last).value, "业务员");
      assert.equal(sheet.getRow(2).getCell(last).value, "温见清、陈馨");
      assert.ok(!sheet.getRow(3).getCell(last).value);
    }
  } finally { globals.prisma = previous; }
});

test("sales catalog columns are default-visible current metadata and require unanimity across members and days", () => {
  const config = visibleColumns("sales", ["brand", "productTags", "price"]);
  assert.deepEqual(config.map(c => c.labelZh), ["商品品牌", "产品标签", "售价"]);
  assert.ok(config.every(c => c.defaultVisible && !c.unavailable && /Listing 当前快照.*类型投影/.test(c.requiresField)));
  assert.equal(config.find(c => c.key === "price")!.numeric, true);
  assert.deepEqual(visibleColumns("performance", ["brand", "productTags"]), []);
  for (const dimension of ["msku", "asin", "parentAsin", "sku", "store", "developer", "spu"]) {
    const defaults = defaultVisibleColumnKeys("sales", dimension);
    for (const key of ["inventoryCapturedAt", "currency", "marketplace", "salesperson", "awdAvailable", "awdInbound", "operations", "salesInsight"]) assert.ok(!defaults.includes(key));
    for (const key of ["salesperson", "awdAvailable", "awdInbound", "operations", "salesInsight"]) assert.equal(columns.sales.find(c => c.key === key)!.unavailable, true);
    for (const key of ["trend", "average7", "totalInventory", "brand", "productTags", "price"]) assert.ok(defaults.includes(key));
    for (const key of ["brand", "productTags", "price"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&sortBy=${key}&sortOrder=desc`), "sales");
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("sales", query, { organizationId: "org", workspaceId: "ws" }, exporting).text;
        const member = ({ brand: "listingBrand", productTags: "listingProductTags", price: "listingPrice" })[key]!;
        assert.ok(sql.includes(`CASE WHEN count("${member}")=count(*) AND count(DISTINCT "${member}")=1 THEN min("${member}") END`));
        const col = key === "productTags" ? '"productTags"' : key;
        assert.ok(sql.includes(`CASE WHEN count(${col})=count(*) AND count(DISTINCT ${col})=1 THEN min(${col}) END`));
        assert.ok(sql.includes(`ORDER BY "${key}" DESC NULLS LAST, id ASC`));
        assert.doesNotMatch(sql, /payload|sum\((?:brand|"productTags"|price)\)/);
      }
    }
  }
});

test("sales default and selected catalog columns export identical CSV and numeric XLSX with missing values blank", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const rows = [{ brand: "品牌", productTags: "新品、重点", price: 0 }, { brand: null, productTags: null, price: null }];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => sql.text.startsWith("WITH") ? [{ rows: rows.map(row => ({ ...row })), total: 2, totals: [{ currency: "USD", subtotal: 3 }] }] : [] } as unknown as PrismaClient;
  try {
    const { default: ExcelJS } = await import("exceljs");
    const keys = ["brand", "productTags", "price"], labels = ["商品品牌", "产品标签", "售价"];
    for (const selected of [false, true]) {
      const url = new URL("http://localhost/?from=2026-10-24&to=2026-10-24");
      if (selected) for (const key of keys) url.searchParams.append("column", key);
      const query = sellfoxBrowseQuery(url, "sales"), scope = { organizationId: "org", workspaceId: "ws" };
      const csv = (await (await sellfoxWorkbenchExport("sales", query, scope, url)).text()).trim().split("\r\n");
      const headers = csv[0].split(",");
      const indices = labels.map(label => headers.indexOf(`"${label}"`));
      assert.ok(indices.every(i => i >= 0));
      assert.deepEqual(indices.map(i => csv[1].split(",")[i]), ['"品牌"', '"新品、重点"', '0']);
      assert.deepEqual(indices.map(i => csv[2].split(",")[i]), ['""', '""', '""']);
      if (selected) assert.equal(csv[0], '"商品品牌","产品标签","售价"');
      url.searchParams.set("format", "xlsx");
      const response = await sellfoxWorkbenchExport("sales", query, scope, url);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer());
      const sheet = book.worksheets[0];
      assert.deepEqual(indices.map(i => sheet.getRow(1).getCell(i + 1).value), labels);
      assert.deepEqual(indices.map(i => sheet.getRow(2).getCell(i + 1).value), ["品牌", "新品、重点", 0]);
      assert.deepEqual(indices.map(i => sheet.getRow(3).getCell(i + 1).value), [null, null, null]);
      if (selected) assert.equal(sheet.columnCount, 3);
    }
  } finally { globals.prisma = previous; }
});

test("sales trend, average and totalInventory are default-visible in order while explicit selections stay unchanged", () => {
  assert.deepEqual(visibleColumns("sales", ["trend", "average7", "totalInventory"]).map(c => [c.key, c.labelZh, c.sellfoxLabel, c.defaultVisible, c.unavailable]), [
    ["trend", "销量趋势", "销量趋势", true, undefined],
    ["average7", "均值", "均值", true, undefined],
    ["totalInventory", "总库存", "总库存", true, undefined],
  ]);
  assert.equal(columns.sales.find(c => c.key === "average7")!.numeric, true);
  assert.equal(columns.sales.find(c => c.key === "totalInventory")!.numeric, true);
  assert.equal(columns.sales.find(c => c.key === "inventoryCapturedAt")!.defaultVisible, false);
  for (const key of ["awdAvailable", "awdInbound"]) assert.equal(columns.sales.find(c => c.key === key)!.unavailable, true);
  for (const dimension of ["asin", "msku", "sku", "parentAsin", "store", "developer", "spu"]) {
    const defaults = defaultVisibleColumnKeys("sales", dimension);
    assert.deepEqual(defaults.slice(defaults.indexOf("subtotal")), ["subtotal", "trend", "average7", "totalInventory"]);
    for (const selected of [[], ["trend"], ["average7"], ["totalInventory"], defaults.filter(key => key !== "totalInventory")]) {
      const original = [...selected];
      assert.deepEqual(visibleColumns("sales", selected, [], dimension).map(c => c.key), original);
      assert.deepEqual(selected, original);
    }
  }
});

test("sales default CSV/XLSX exports trend, average and totalInventory in every dimension and honors explicit columns", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const quantities = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`2026-10-${20 + i}`, i]));
  const stocks = [
    { storeId: "s1", msku: "m0", fulfillable: 1, totalInventory: 180, inventoryCapturedAt: "2026-10-26T00:00:00.000Z" },
    { storeId: "s1", msku: "m1", fulfillable: 1, totalInventory: 0, inventoryCapturedAt: "2026-10-26T00:00:00.000Z" },
    { storeId: "s1", msku: "m2", fulfillable: 1, totalInventory: null, inventoryCapturedAt: null },
  ];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    if (sql.text.includes("sellfox_inventory_current")) return stocks;
    return [{ total: 3, totals: [], rows: [
      { storeId: "s1", msku: "m0", dailyQuantity: quantities },
      { storeId: "s1", msku: "m1", dailyQuantity: { ...quantities, "2026-10-20": null } },
      { storeId: "s1", msku: "m2", dailyQuantity: Object.fromEntries(Object.keys(quantities).map(date => [date, 0])) },
    ] }];
  } } as unknown as PrismaClient;
  try {
    const { default: ExcelJS } = await import("exceljs");
    for (const dimension of ["asin", "msku", "sku", "parentAsin", "store", "developer", "spu"]) {
      for (const selected of [undefined, ["trend"], ["average7"], ["totalInventory"], ["trend", "average7", "totalInventory"]]) {
        const url = new URL(`http://localhost/?dimension=${dimension}&from=2026-10-20&to=2026-10-26&metric=orders`);
        if (selected) for (const key of selected) url.searchParams.append("column", key);
        const query = sellfoxBrowseQuery(url, "sales"), scope = { organizationId: "org", workspaceId: "ws" };
        const csv = (await (await sellfoxWorkbenchExport("sales", query, scope, url)).text()).trim().split("\r\n");
        const hasAverage = !selected || selected.includes("average7");
        const hasTrend = !selected || selected.includes("trend");
        const hasInventory = !selected || selected.includes("totalInventory");
        const labels = [...(hasTrend ? ["销量趋势"] : []), ...(hasAverage ? ["均值"] : []), ...(hasInventory ? ["总库存"] : [])];
        const suffix = labels.map(label => `"${label}"`).join(",");
        assert.ok(csv[0].endsWith(suffix));
        if (selected) assert.equal(csv[0], suffix);
        assert.ok(!csv[0].includes('"库存快照时间"'));
        const indices = labels.map(label => csv[0].split(",").indexOf(`"${label}"`));
        assert.deepEqual(indices.map(i => csv[1].split(",")[i]), [...(hasTrend ? ['"0 | 1 | 2 | 3 | 4 | 5 | 6"'] : []), ...(hasAverage ? ["3"] : []), ...(hasInventory ? ["180"] : [])]);
        // row2 missing day → trend/average blank; inventory 0 kept
        assert.deepEqual(indices.map(i => csv[2].split(",")[i]), [...(hasTrend ? ['""'] : []), ...(hasAverage ? ['""'] : []), ...(hasInventory ? ["0"] : [])]);
        assert.deepEqual(indices.map(i => csv[3].split(",")[i]), [...(hasTrend ? ['"0 | 0 | 0 | 0 | 0 | 0 | 0"'] : []), ...(hasAverage ? ["0"] : []), ...(hasInventory ? ['""'] : [])]);
        url.searchParams.set("format", "xlsx");
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(await (await sellfoxWorkbenchExport("sales", query, scope, url)).arrayBuffer());
        const sheet = book.worksheets[0];
        assert.deepEqual(indices.map(i => sheet.getRow(1).getCell(i + 1).value), labels);
        assert.deepEqual(indices.map(i => sheet.getRow(2).getCell(i + 1).value), [...(hasTrend ? ["0 | 1 | 2 | 3 | 4 | 5 | 6"] : []), ...(hasAverage ? [3] : []), ...(hasInventory ? [180] : [])]);
        assert.deepEqual(indices.map(i => sheet.getRow(3).getCell(i + 1).value), [...(hasTrend ? [null] : []), ...(hasAverage ? [null] : []), ...(hasInventory ? [0] : [])]);
        assert.deepEqual(indices.map(i => sheet.getRow(4).getCell(i + 1).value), [...(hasTrend ? ["0 | 0 | 0 | 0 | 0 | 0 | 0"] : []), ...(hasAverage ? [0] : []), ...(hasInventory ? [null] : [])]);
        if (selected) assert.equal(sheet.columnCount, selected.length);
      }
    }
  } finally { globals.prisma = previous; }
});

test("sales trend remains derived from seven complete in-range quantity days independent of the selected metric", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const dates = Array.from({ length: 7 }, (_, i) => `2026-10-${20 + i}`);
  const quantities = Object.fromEntries(dates.map((d, i) => [d, i]));
  globals.prisma = { $queryRaw: async () => [{ total: 3, totals: [], rows: [
    { dailyQuantity: quantities }, { dailyQuantity: { ...quantities, [dates[0]]: null } }, { dailyQuantity: {} },
  ] }] } as unknown as PrismaClient;
  try {
    const result = await readSellfoxWorkbench("sales", sellfoxBrowseQuery(new URL("http://localhost/?from=2026-10-20&to=2026-10-26&metric=orders")), { organizationId: "org", workspaceId: "ws" });
    assert.equal(result.rows[0].trend, "0 | 1 | 2 | 3 | 4 | 5 | 6"); assert.equal(result.rows[0].average7, 3);
    for (const row of result.rows.slice(1)) { assert.equal(row.trend, null); assert.equal(row.average7, null); }
  } finally { globals.prisma = previous; }
});

test("performance evaluation and channel quantities are default-visible typed facts matching Sellfox table", () => {
  const keys = ["evaluationSaleNum", "channelSaleNum"];
  const config = visibleColumns("performance", keys);
  assert.deepEqual(config.map(c => [c.key, c.labelZh, c.numeric, c.defaultVisible, c.unavailable]), [
    ["evaluationSaleNum", "测评销量", true, true, undefined],
    ["channelSaleNum", "多渠道销量", true, true, undefined],
  ]);
  for (const c of config) {
    assert.equal(captions[c.key], c.labelZh);
    assert.ok(c.requiresField.includes(`销售利润 payload.${c.key} 类型投影`));
    assert.ok(defaultVisibleColumnKeys("performance").includes(c.key));
    assert.deepEqual(visibleColumns("sales", [c.key]), []);
    assert.deepEqual(visibleColumns("listings", [c.key]), []);
  }
  assert.ok(config[0].requiresField.includes("数量"));
  for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer"]) {
    for (const onlySettle of [false, true]) for (const key of keys) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&from=2026-10-24&to=2026-10-25&onlySettle=${Number(onlySettle)}&sortBy=${key}&sortOrder=${sortOrder}`), "performance");
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
        for (const qty of keys) {
          assert.ok(sql.text.includes(`s."${qty}"`));
          assert.equal(sql.text.split(`COALESCE(sum("${qty}"),0)::float AS "${qty}"`).length - 1, 2);
        }
        assert.doesNotMatch(sql.text, /payload/);
        assert.ok(sql.text.includes(`ORDER BY "${key}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
      }
    }
  }
  assert.doesNotMatch(workbenchReadSql("sales", sellfoxBrowseQuery(new URL("http://localhost/")), { organizationId: "org", workspaceId: "ws" }).text, /evaluationSaleNum|channelSaleNum/);
});

test("selected profit quantity columns export zero and nonzero numbers in CSV and Excel", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [{ evaluationSaleNum: 0, channelSaleNum: 1 }, { evaluationSaleNum: 2, channelSaleNum: 0 }], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?reportDate=2026-10-25&column=evaluationSaleNum&column=channelSaleNum");
  const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
  try {
    assert.equal((await (await sellfoxWorkbenchExport("performance", query, scope, url)).text()).trim(), '"测评销量","多渠道销量"\r\n0,1\r\n2,0');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    assert.deepEqual(book.worksheets[0].getSheetValues().slice(1).map(row => (row as unknown[]).slice(1)), [["测评销量", "多渠道销量"], [0, 1], [2, 0]]);
  } finally { globals.prisma = previous; }
});

test("performance ad channel costs are optional typed columns, aggregate twice and sort without payload", () => {
  const keys = ["adSpCost", "adSdCost", "adSbCost", "adSbvCost", "adSbsCost"];
  const labels = ["SP广告费", "SD广告费", "SB广告费", "SBV广告费", "SBS广告费"];
  const config = visibleColumns("performance", keys);
  assert.deepEqual(config.map(c => [c.key, c.labelZh, c.numeric, c.defaultVisible, c.unavailable]), keys.map((key, i) => [key, labels[i], true, false, undefined]));
  assert.ok(defaultVisibleColumnKeys("performance").includes("adCost"));
  assert.equal(visibleColumns("performance", ["adCost"])[0].labelZh, "广告花费");
  assert.deepEqual(visibleColumns("performance", ["adTotalCost"]), []);
  for (const c of config) {
    assert.equal(captions[c.key], c.labelZh);
    assert.equal(c.requiresField, `销售利润 payload.${c.key} 类型投影`);
    assert.ok(!defaultVisibleColumnKeys("performance").includes(c.key));
    assert.deepEqual(visibleColumns("sales", [c.key]), []);
    assert.deepEqual(visibleColumns("listings", [c.key]), []);
  }
  for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer", "spu"]) {
    for (const onlySettle of [0, 1]) for (const key of keys) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&onlySettle=${onlySettle}&sortBy=${key}&sortOrder=${sortOrder}`), "performance");
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
        for (const cost of keys) {
          assert.ok(sql.text.includes(`s."${cost}"`));
          assert.equal(sql.text.split(`COALESCE(sum("${cost}"),0)::float AS "${cost}"`).length - 1, 2);
        }
        assert.doesNotMatch(sql.text, /payload|adTotalCost/);
        assert.ok(sql.text.includes(`s."adCost"`));
        assert.ok(sql.text.includes(`ORDER BY "${key}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
      }
    }
  }
  assert.doesNotMatch(workbenchReadSql("sales", sellfoxBrowseQuery(new URL("http://localhost/")), { organizationId: "org", workspaceId: "ws" }).text, /adSpCost|adSdCost|adSbCost|adSbvCost|adSbsCost/);
});

test("selected performance ad channel CSV and Excel preserve numeric zero and empty NULL", async () => {
  const keys = ["adSpCost", "adSdCost", "adSbCost", "adSbvCost", "adSbsCost"];
  const labels = ["SP广告费", "SD广告费", "SB广告费", "SBV广告费", "SBS广告费"];
  const values = [0, 2.5, 4, 5, 6.75];
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [Object.fromEntries(keys.map((k, i) => [k, values[i]])), Object.fromEntries(keys.map(k => [k, null]))], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?reportDate=2026-10-25");
  keys.forEach(key => url.searchParams.append("column", key));
  try {
    const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
    const csv = await (await sellfoxWorkbenchExport("performance", query, scope, url)).text();
    assert.equal(csv.trim(), labels.map(l => `"${l}"`).join(",") + '\r\n0,2.5,4,5,6.75\r\n"","","","",""');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), labels);
    assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), values);
    keys.forEach((_, i) => assert.ok([null, ""].includes(sheet.getRow(3).getCell(i + 1).value as null | string)));
  } finally { globals.prisma = previous; }
});

test("performance FBA storage/removal/disposal costs are optional typed columns, aggregate twice and sort without payload", () => {
  const keys = ["fbaStorageFeeAmount", "fbaLongTermStorageFeeAmount", "fbaRemovalFeeAmount", "fbaDisposalFeeAmount"];
  const labels = ["FBA仓储费", "长期仓储费", "FBA移除费", "FBA弃置费"];
  const config = visibleColumns("performance", keys);
  assert.deepEqual(config.map(c => [c.key, c.labelZh, c.numeric, c.defaultVisible, c.unavailable]), keys.map((key, i) => [key, labels[i], true, false, undefined]));
  assert.ok(defaultVisibleColumnKeys("performance").includes("adCost"));
  assert.equal(visibleColumns("performance", ["adCost"])[0].labelZh, "广告花费");
  assert.deepEqual(visibleColumns("performance", ["adTotalCost"]), []);
  for (const c of config) {
    assert.equal(captions[c.key], c.labelZh);
    assert.equal(c.requiresField, `销售利润 payload.${c.key} 类型投影`);
    assert.ok(!defaultVisibleColumnKeys("performance").includes(c.key));
    assert.deepEqual(visibleColumns("sales", [c.key]), []);
    assert.deepEqual(visibleColumns("listings", [c.key]), []);
  }
  for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer", "spu"]) {
    for (const onlySettle of [0, 1]) for (const key of keys) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&onlySettle=${onlySettle}&sortBy=${key}&sortOrder=${sortOrder}`), "performance");
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
        for (const cost of keys) {
          assert.ok(sql.text.includes(`s."${cost}"`));
          assert.equal(sql.text.split(`COALESCE(sum("${cost}"),0)::float AS "${cost}"`).length - 1, 2);
        }
        assert.doesNotMatch(sql.text, /payload|adTotalCost/);
        assert.ok(sql.text.includes(`s."adCost"`));
        assert.ok(sql.text.includes(`ORDER BY "${key}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
      }
    }
  }
  assert.doesNotMatch(workbenchReadSql("sales", sellfoxBrowseQuery(new URL("http://localhost/")), { organizationId: "org", workspaceId: "ws" }).text, /fbaStorageFeeAmount|fbaLongTermStorageFeeAmount|fbaRemovalFeeAmount|fbaDisposalFeeAmount/);
});

test("selected performance FBA storage/removal/disposal CSV and Excel preserve numeric zero and empty NULL", async () => {
  const keys = ["fbaStorageFeeAmount", "fbaLongTermStorageFeeAmount", "fbaRemovalFeeAmount", "fbaDisposalFeeAmount"];
  const labels = ["FBA仓储费", "长期仓储费", "FBA移除费", "FBA弃置费"];
  const values = [0, 2.5, 4, 5];
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [Object.fromEntries(keys.map((k, i) => [k, values[i]])), Object.fromEntries(keys.map(k => [k, null]))], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?reportDate=2026-10-25");
  keys.forEach(key => url.searchParams.append("column", key));
  try {
    const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
    const csv = await (await sellfoxWorkbenchExport("performance", query, scope, url)).text();
    assert.equal(csv.trim(), labels.map(l => `"${l}"`).join(",") + '\r\n0,2.5,4,5\r\n"","","",""');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), labels);
    assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), values);
    keys.forEach((_, i) => assert.ok([null, ""].includes(sheet.getRow(3).getCell(i + 1).value as null | string)));
  } finally { globals.prisma = previous; }
});

test("performance custom/service/storage/compensation/evaluation costs are optional typed columns, aggregate twice and sort without payload", () => {
  const keys = ["customAsinFee", "customShopFee", "serviceFeeAmount", "storageFeeAmount", "compensationAmount", "evaluationFee"];
  const labels = ["产品自定义费用", "店铺自定义费用", "服务费", "仓储费", "赔偿金", "测评费"];
  const config = visibleColumns("performance", keys);
  assert.deepEqual(config.map(c => [c.key, c.labelZh, c.numeric, c.defaultVisible, c.unavailable]), keys.map((key, i) => [key, labels[i], true, false, undefined]));
  assert.ok(defaultVisibleColumnKeys("performance").includes("adCost"));
  assert.equal(visibleColumns("performance", ["adCost"])[0].labelZh, "广告花费");
  assert.deepEqual(visibleColumns("performance", ["adTotalCost"]), []);
  for (const c of config) {
    assert.equal(captions[c.key], c.labelZh);
    assert.equal(c.requiresField, `销售利润 payload.${c.key} 类型投影`);
    assert.ok(!defaultVisibleColumnKeys("performance").includes(c.key));
    assert.deepEqual(visibleColumns("sales", [c.key]), []);
    assert.deepEqual(visibleColumns("listings", [c.key]), []);
  }
  for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer", "spu"]) {
    for (const onlySettle of [0, 1]) for (const key of keys) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&onlySettle=${onlySettle}&sortBy=${key}&sortOrder=${sortOrder}`), "performance");
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
        for (const cost of keys) {
          assert.ok(sql.text.includes(`s."${cost}"`));
          assert.equal(sql.text.split(`COALESCE(sum("${cost}"),0)::float AS "${cost}"`).length - 1, 2);
        }
        assert.doesNotMatch(sql.text, /payload|adTotalCost/);
        assert.ok(sql.text.includes(`s."adCost"`));
        assert.ok(sql.text.includes(`ORDER BY "${key}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
      }
    }
  }
  assert.doesNotMatch(workbenchReadSql("sales", sellfoxBrowseQuery(new URL("http://localhost/")), { organizationId: "org", workspaceId: "ws" }).text, /customAsinFee|customShopFee|serviceFeeAmount|storageFeeAmount|compensationAmount|evaluationFee/);
});

test("selected performance custom/service/storage/compensation/evaluation CSV and Excel preserve numeric zero and empty NULL", async () => {
  const keys = ["customAsinFee", "customShopFee", "serviceFeeAmount", "storageFeeAmount", "compensationAmount", "evaluationFee"];
  const labels = ["产品自定义费用", "店铺自定义费用", "服务费", "仓储费", "赔偿金", "测评费"];
  const values = [0, 2.5, 4, 5, 6, 7];
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [Object.fromEntries(keys.map((k, i) => [k, values[i]])), Object.fromEntries(keys.map(k => [k, null]))], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?reportDate=2026-10-25");
  keys.forEach(key => url.searchParams.append("column", key));
  try {
    const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
    const csv = await (await sellfoxWorkbenchExport("performance", query, scope, url)).text();
    assert.equal(csv.trim(), labels.map(l => `"${l}"`).join(",") + '\r\n0,2.5,4,5,6,7\r\n"","","","","",""');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), labels);
    assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), values);
    keys.forEach((_, i) => assert.ok([null, ""].includes(sheet.getRow(3).getCell(i + 1).value as null | string)));
  } finally { globals.prisma = previous; }
});

test("performance optional promo/overage/chargeback/claim/dsf/other/buyer/regulatory costs are optional typed columns, aggregate twice and sort without payload", () => {
  const keys = ["promotionTotalAmount", "fbaOverageFeeAmount", "chargebackAmount", "guaranteeClaimAmount", "digitalServicesFeeAmount", "otherPriceAmount", "shippingChargeAmount", "regulatoryFeeAmount"];
  const labels = ["促销费", "FBA超量仓储费", "拒付退款", "A-Z索赔退款", "数字服务费", "其他费用", "买家运费", "监管费"];
  const config = visibleColumns("performance", keys);
  assert.deepEqual(config.map(c => [c.key, c.labelZh, c.numeric, c.defaultVisible, c.unavailable]), keys.map((key, i) => [key, labels[i], true, false, undefined]));
  assert.ok(defaultVisibleColumnKeys("performance").includes("adCost"));
  assert.equal(visibleColumns("performance", ["adCost"])[0].labelZh, "广告花费");
  assert.deepEqual(visibleColumns("performance", ["adTotalCost"]), []);
  for (const c of config) {
    assert.equal(captions[c.key], c.labelZh);
    assert.equal(c.requiresField, `销售利润 payload.${c.key} 类型投影`);
    assert.ok(!defaultVisibleColumnKeys("performance").includes(c.key));
    assert.deepEqual(visibleColumns("sales", [c.key]), []);
    assert.deepEqual(visibleColumns("listings", [c.key]), []);
  }
  for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer", "spu"]) {
    for (const onlySettle of [0, 1]) for (const key of keys) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&onlySettle=${onlySettle}&sortBy=${key}&sortOrder=${sortOrder}`), "performance");
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
        for (const cost of keys) {
          assert.ok(sql.text.includes(`s."${cost}"`));
          assert.equal(sql.text.split(`COALESCE(sum("${cost}"),0)::float AS "${cost}"`).length - 1, 2);
        }
        assert.doesNotMatch(sql.text, /payload|adTotalCost/);
        assert.ok(sql.text.includes(`s."adCost"`));
        assert.ok(sql.text.includes(`ORDER BY "${key}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
      }
    }
  }
  assert.doesNotMatch(workbenchReadSql("sales", sellfoxBrowseQuery(new URL("http://localhost/")), { organizationId: "org", workspaceId: "ws" }).text, /promotionTotalAmount|fbaOverageFeeAmount|chargebackAmount|guaranteeClaimAmount|digitalServicesFeeAmount|otherPriceAmount|shippingChargeAmount|regulatoryFeeAmount/);
});

test("selected performance optional promo/overage/chargeback/claim/dsf/other/buyer/regulatory CSV and Excel preserve numeric zero and empty NULL", async () => {
  const keys = ["promotionTotalAmount", "fbaOverageFeeAmount", "chargebackAmount", "guaranteeClaimAmount", "digitalServicesFeeAmount", "otherPriceAmount", "shippingChargeAmount", "regulatoryFeeAmount"];
  const labels = ["促销费", "FBA超量仓储费", "拒付退款", "A-Z索赔退款", "数字服务费", "其他费用", "买家运费", "监管费"];
  const values = [0, 2.5, 4, 5, 6, 7, 8, 9];
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [Object.fromEntries(keys.map((k, i) => [k, values[i]])), Object.fromEntries(keys.map(k => [k, null]))], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?reportDate=2026-10-25");
  keys.forEach(key => url.searchParams.append("column", key));
  try {
    const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
    const csv = await (await sellfoxWorkbenchExport("performance", query, scope, url)).text();
    assert.equal(csv.trim(), labels.map(l => `"${l}"`).join(",") + '\r\n0,2.5,4,5,6,7,8,9\r\n"","","","","","","",""');
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), labels);
    assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), values);
    keys.forEach((_, i) => assert.ok([null, ""].includes(sheet.getRow(3).getCell(i + 1).value as null | string)));
  } finally { globals.prisma = previous; }
});

test("performance contiguous coupon/deal/vine/star/sub/return/inbound and companions costs are optional typed columns, aggregate twice and sort without payload", () => {
  const keys = ["couponPaymentAmount", "sellerDealPaymentAmount", "vineFeeAmount", "starStorageFeeAmount", "subscriptionAmount", "fbaCustomerReturnAmount", "fbaInboundConvenienceFeeAmount", "inboundTransportationFeeAmount", "shippingChargebackAmount", "giftwrapChargebackAmount", "costOfPointsGrantedAmount", "orderOtherPriceAmount"];
  const labels = ["优惠券支付", "Deal费用", "Vine费用", "星级仓储费", "订阅费", "FBA买家退货费", "FBA入库配置费", "入库运输费", "买家运费扣除", "礼品包装费扣除", "积分费用", "订单其他费"];
  const config = visibleColumns("performance", keys);
  assert.deepEqual(config.map(c => [c.key, c.labelZh, c.numeric, c.defaultVisible, c.unavailable]), keys.map((key, i) => [key, labels[i], true, false, undefined]));
  assert.ok(defaultVisibleColumnKeys("performance").includes("adCost"));
  assert.equal(visibleColumns("performance", ["adCost"])[0].labelZh, "广告花费");
  assert.deepEqual(visibleColumns("performance", ["adTotalCost"]), []);
  for (const c of config) {
    assert.equal(captions[c.key], c.labelZh);
    assert.equal(c.requiresField, `销售利润 payload.${c.key} 类型投影`);
    assert.ok(!defaultVisibleColumnKeys("performance").includes(c.key));
    assert.deepEqual(visibleColumns("sales", [c.key]), []);
    assert.deepEqual(visibleColumns("listings", [c.key]), []);
  }
  for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer", "spu"]) {
    for (const onlySettle of [0, 1]) for (const key of keys) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&onlySettle=${onlySettle}&sortBy=${key}&sortOrder=${sortOrder}`), "performance");
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
        for (const cost of keys) {
          assert.ok(sql.text.includes(`s."${cost}"`));
          assert.equal(sql.text.split(`COALESCE(sum("${cost}"),0)::float AS "${cost}"`).length - 1, 2);
        }
        assert.doesNotMatch(sql.text, /payload|adTotalCost/);
        assert.ok(sql.text.includes(`s."adCost"`));
        assert.ok(sql.text.includes(`ORDER BY "${key}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
      }
    }
  }
  assert.doesNotMatch(workbenchReadSql("sales", sellfoxBrowseQuery(new URL("http://localhost/")), { organizationId: "org", workspaceId: "ws" }).text, /couponPaymentAmount|sellerDealPaymentAmount|vineFeeAmount|starStorageFeeAmount|subscriptionAmount|fbaCustomerReturnAmount|fbaInboundConvenienceFeeAmount|inboundTransportationFeeAmount|shippingChargebackAmount|giftwrapChargebackAmount|costOfPointsGrantedAmount|orderOtherPriceAmount/);
});

test("selected performance contiguous coupon/deal/vine/star/sub/return/inbound and companions CSV and Excel preserve numeric zero and empty NULL", async () => {
  const keys = ["couponPaymentAmount", "sellerDealPaymentAmount", "vineFeeAmount", "starStorageFeeAmount", "subscriptionAmount", "fbaCustomerReturnAmount", "fbaInboundConvenienceFeeAmount", "inboundTransportationFeeAmount", "shippingChargebackAmount", "giftwrapChargebackAmount", "costOfPointsGrantedAmount", "orderOtherPriceAmount"];
  const labels = ["优惠券支付", "Deal费用", "Vine费用", "星级仓储费", "订阅费", "FBA买家退货费", "FBA入库配置费", "入库运输费", "买家运费扣除", "礼品包装费扣除", "积分费用", "订单其他费"];
  const values = [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [Object.fromEntries(keys.map((k, i) => [k, values[i]])), Object.fromEntries(keys.map(k => [k, null]))], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?reportDate=2026-10-25");
  keys.forEach(key => url.searchParams.append("column", key));
  try {
    const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
    const csv = await (await sellfoxWorkbenchExport("performance", query, scope, url)).text();
    assert.equal(csv.trim(), labels.map(l => `"${l}"`).join(",") + '\r\n' + values.join(",") + '\r\n' + keys.map(() => '""').join(","));
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), labels);
    assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), values);
    keys.forEach((_, i) => assert.ok([null, ""].includes(sheet.getRow(3).getCell(i + 1).value as null | string)));
  } finally { globals.prisma = previous; }
});

test("performance next inbound/agl/paid/hrr/upstream/mfn/adjustment/other/avg/refund/liquidation costs are optional typed columns, aggregate twice and sort without payload", () => {
  const keys = ["fbaInboundTransportationProgramFee", "aglFeeAmount", "paidServicesFeeAmount", "customerReturnHrrUnitFeeAmount", "amazonUpstreamStorageTransportationFeeAmount", "amazonUpstreamProcessingFeeAmount", "mfnPostageFeeAmount", "adjustmentFeeAmount", "otherServiceFeeAmount", "avgHeadTripPrice", "purchaseRefundPrice", "revenueAmount"];
  const labels = ["FBA入库运输计划费", "AGL费用", "付费服务费", "HRR退货单位费", "上游仓储运输费", "上游处理费", "MFN邮资", "调整费", "其他服务费", "平均头程", "订单内退款", "清算费"];
  const config = visibleColumns("performance", keys);
  assert.deepEqual(config.map(c => [c.key, c.labelZh, c.numeric, c.defaultVisible, c.unavailable]), keys.map((key, i) => [key, labels[i], true, false, undefined]));
  assert.ok(defaultVisibleColumnKeys("performance").includes("adCost"));
  assert.equal(visibleColumns("performance", ["adCost"])[0].labelZh, "广告花费");
  assert.deepEqual(visibleColumns("performance", ["adTotalCost"]), []);
  for (const c of config) {
    assert.equal(captions[c.key], c.labelZh);
    assert.equal(c.requiresField, `销售利润 payload.${c.key} 类型投影`);
    assert.ok(!defaultVisibleColumnKeys("performance").includes(c.key));
    assert.deepEqual(visibleColumns("sales", [c.key]), []);
    assert.deepEqual(visibleColumns("listings", [c.key]), []);
  }
  for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer", "spu"]) {
    for (const onlySettle of [0, 1]) for (const key of keys) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&onlySettle=${onlySettle}&sortBy=${key}&sortOrder=${sortOrder}`), "performance");
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
        for (const cost of keys) {
          assert.ok(sql.text.includes(`s."${cost}"`));
          assert.equal(sql.text.split(`COALESCE(sum("${cost}"),0)::float AS "${cost}"`).length - 1, 2);
        }
        assert.doesNotMatch(sql.text, /payload|adTotalCost/);
        assert.ok(sql.text.includes(`s."adCost"`));
        assert.ok(sql.text.includes(`ORDER BY "${key}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
      }
    }
  }
  assert.doesNotMatch(workbenchReadSql("sales", sellfoxBrowseQuery(new URL("http://localhost/")), { organizationId: "org", workspaceId: "ws" }).text, /fbaInboundTransportationProgramFee|aglFeeAmount|paidServicesFeeAmount|customerReturnHrrUnitFeeAmount|amazonUpstreamStorageTransportationFeeAmount|amazonUpstreamProcessingFeeAmount|mfnPostageFeeAmount|adjustmentFeeAmount|otherServiceFeeAmount|avgHeadTripPrice|purchaseRefundPrice|revenueAmount/);
});

test("selected performance next inbound/agl/paid/hrr/upstream/mfn/adjustment/other/avg/refund/liquidation CSV and Excel preserve numeric zero and empty NULL", async () => {
  const keys = ["fbaInboundTransportationProgramFee", "aglFeeAmount", "paidServicesFeeAmount", "customerReturnHrrUnitFeeAmount", "amazonUpstreamStorageTransportationFeeAmount", "amazonUpstreamProcessingFeeAmount", "mfnPostageFeeAmount", "adjustmentFeeAmount", "otherServiceFeeAmount", "avgHeadTripPrice", "purchaseRefundPrice", "revenueAmount"];
  const labels = ["FBA入库运输计划费", "AGL费用", "付费服务费", "HRR退货单位费", "上游仓储运输费", "上游处理费", "MFN邮资", "调整费", "其他服务费", "平均头程", "订单内退款", "清算费"];
  const values = [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [Object.fromEntries(keys.map((k, i) => [k, values[i]])), Object.fromEntries(keys.map(k => [k, null]))], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?reportDate=2026-10-25");
  keys.forEach(key => url.searchParams.append("column", key));
  try {
    const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
    const csv = await (await sellfoxWorkbenchExport("performance", query, scope, url)).text();
    assert.equal(csv.trim(), labels.map(l => `"${l}"`).join(",") + '\r\n' + values.join(",") + '\r\n' + keys.map(() => '""').join(","));
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), labels);
    assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), values);
    keys.forEach((_, i) => assert.ok([null, ""].includes(sheet.getRow(3).getCell(i + 1).value as null | string)));
  } finally { globals.prisma = previous; }
});

test("performance service refund/Tl deferred/tax/income/payment/closing/imaging/netCo/vat/cod costs are optional typed columns, aggregate twice and sort without payload", () => {
  const keys = ["fbaPerUnitFulfillmentFeeRefundAmount", "fbaWeightBasedFeeRefundAmount", "deferredAmount", "withheldTaxAmount", "otherPriceIncomeAmount", "paymentMethodFeeAmount", "fixedClosingFeeAmount", "variableClosingFeeAmount", "imagingServicesFeeAmount", "netCoAmount", "comminglingVatAmount", "codFeeAmount"];
  const labels = ["FBA按件履约费退款", "FBA重量费退款", "延期金额", "商城代扣税", "其他收入", "支付方式费", "固定成交费", "可变成交费", "影像服务费", "净Co金额", "混卖VAT", "COD费用"];
  const config = visibleColumns("performance", keys);
  assert.deepEqual(config.map(c => [c.key, c.labelZh, c.numeric, c.defaultVisible, c.unavailable]), keys.map((key, i) => [key, labels[i], true, false, undefined]));
  assert.ok(defaultVisibleColumnKeys("performance").includes("adCost"));
  assert.equal(visibleColumns("performance", ["adCost"])[0].labelZh, "广告花费");
  assert.deepEqual(visibleColumns("performance", ["adTotalCost"]), []);
  for (const c of config) {
    assert.equal(captions[c.key], c.labelZh);
    assert.equal(c.requiresField, `销售利润 payload.${c.key} 类型投影`);
    assert.ok(!defaultVisibleColumnKeys("performance").includes(c.key));
    assert.deepEqual(visibleColumns("sales", [c.key]), []);
    assert.deepEqual(visibleColumns("listings", [c.key]), []);
  }
  for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer", "spu"]) {
    for (const onlySettle of [0, 1]) for (const key of keys) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&onlySettle=${onlySettle}&sortBy=${key}&sortOrder=${sortOrder}`), "performance");
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
        for (const cost of keys) {
          assert.ok(sql.text.includes(`s."${cost}"`));
          assert.equal(sql.text.split(`COALESCE(sum("${cost}"),0)::float AS "${cost}"`).length - 1, 2);
        }
        assert.doesNotMatch(sql.text, /payload|adTotalCost/);
        assert.ok(sql.text.includes(`s."adCost"`));
        assert.ok(sql.text.includes(`ORDER BY "${key}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
      }
    }
  }
  assert.doesNotMatch(workbenchReadSql("sales", sellfoxBrowseQuery(new URL("http://localhost/")), { organizationId: "org", workspaceId: "ws" }).text, /fbaPerUnitFulfillmentFeeRefundAmount|fbaWeightBasedFeeRefundAmount|deferredAmount|withheldTaxAmount|otherPriceIncomeAmount|paymentMethodFeeAmount|fixedClosingFeeAmount|variableClosingFeeAmount|imagingServicesFeeAmount|netCoAmount|comminglingVatAmount|codFeeAmount/);
});

test("selected performance service refund/Tl deferred/tax/income/payment/closing/imaging/netCo/vat/cod CSV and Excel preserve numeric zero and empty NULL", async () => {
  const keys = ["fbaPerUnitFulfillmentFeeRefundAmount", "fbaWeightBasedFeeRefundAmount", "deferredAmount", "withheldTaxAmount", "otherPriceIncomeAmount", "paymentMethodFeeAmount", "fixedClosingFeeAmount", "variableClosingFeeAmount", "imagingServicesFeeAmount", "netCoAmount", "comminglingVatAmount", "codFeeAmount"];
  const labels = ["FBA按件履约费退款", "FBA重量费退款", "延期金额", "商城代扣税", "其他收入", "支付方式费", "固定成交费", "可变成交费", "影像服务费", "净Co金额", "混卖VAT", "COD费用"];
  const values = [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [Object.fromEntries(keys.map((k, i) => [k, values[i]])), Object.fromEntries(keys.map(k => [k, null]))], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?reportDate=2026-10-25");
  keys.forEach(key => url.searchParams.append("column", key));
  try {
    const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
    const csv = await (await sellfoxWorkbenchExport("performance", query, scope, url)).text();
    assert.equal(csv.trim(), labels.map(l => `"${l}"`).join(",") + '\r\n' + values.join(",") + '\r\n' + keys.map(() => '""').join(","));
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), labels);
    assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), values);
    keys.forEach((_, i) => assert.ok([null, ""].includes(sheet.getRow(3).getCell(i + 1).value as null | string)));
  } finally { globals.prisma = previous; }
});

test("performance fee-wrap eval/deal/coupon/SAFE-T/income/promotion costs are optional typed columns, aggregate twice and sort without payload", () => {
  const keys = ["evaluationCapital", "evaluationCommission", "dealPerformanceFeeAmount", "couponParticipationFeeAmount", "safetReimbursedAmount", "affordabilityExpenseAmount", "withheldFeeAmount", "chargebackIncomeAmount", "guaranteeClaimIncomeAmount", "promotionSalesAmount", "promotionShippingAmount", "promotionTaxAmount"];
  const labels = ["测评本金", "测评佣金", "Deal表现费", "优惠券参与费", "SAFE-T赔偿", "可负担性费用", "预扣费用", "拒付收入", "A-Z索赔收入", "促销销售额", "促销运费", "促销税费"];
  const config = visibleColumns("performance", keys);
  assert.deepEqual(config.map(c => [c.key, c.labelZh, c.numeric, c.defaultVisible, c.unavailable]), keys.map((key, i) => [key, labels[i], true, false, undefined]));
  assert.ok(defaultVisibleColumnKeys("performance").includes("adCost"));
  assert.equal(visibleColumns("performance", ["adCost"])[0].labelZh, "广告花费");
  assert.deepEqual(visibleColumns("performance", ["adTotalCost"]), []);
  for (const c of config) {
    assert.equal(captions[c.key], c.labelZh);
    assert.equal(c.requiresField, `销售利润 payload.${c.key} 类型投影`);
    assert.ok(!defaultVisibleColumnKeys("performance").includes(c.key));
    assert.deepEqual(visibleColumns("sales", [c.key]), []);
    assert.deepEqual(visibleColumns("listings", [c.key]), []);
  }
  for (const dimension of ["asin", "parentAsin", "msku", "sku", "store", "developer", "spu"]) {
    for (const onlySettle of [0, 1]) for (const key of keys) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&onlySettle=${onlySettle}&sortBy=${key}&sortOrder=${sortOrder}`), "performance");
      for (const exporting of [false, true]) {
        const sql = workbenchReadSql("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
        for (const cost of keys) {
          assert.ok(sql.text.includes(`s."${cost}"`));
          assert.equal(sql.text.split(`COALESCE(sum("${cost}"),0)::float AS "${cost}"`).length - 1, 2);
        }
        assert.doesNotMatch(sql.text, /payload|adTotalCost/);
        assert.ok(sql.text.includes(`s."adCost"`));
        assert.ok(sql.text.includes(`ORDER BY "${key}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC LIMIT`));
      }
    }
  }
  assert.doesNotMatch(workbenchReadSql("sales", sellfoxBrowseQuery(new URL("http://localhost/")), { organizationId: "org", workspaceId: "ws" }).text, /evaluationCapital|evaluationCommission|dealPerformanceFeeAmount|couponParticipationFeeAmount|safetReimbursedAmount|affordabilityExpenseAmount|withheldFeeAmount|chargebackIncomeAmount|guaranteeClaimIncomeAmount|promotionSalesAmount|promotionShippingAmount|promotionTaxAmount/);
});

test("selected performance fee-wrap eval/deal/coupon/SAFE-T/income/promotion CSV and Excel preserve numeric zero and empty NULL", async () => {
  const keys = ["evaluationCapital", "evaluationCommission", "dealPerformanceFeeAmount", "couponParticipationFeeAmount", "safetReimbursedAmount", "affordabilityExpenseAmount", "withheldFeeAmount", "chargebackIncomeAmount", "guaranteeClaimIncomeAmount", "promotionSalesAmount", "promotionShippingAmount", "promotionTaxAmount"];
  const labels = ["测评本金", "测评佣金", "Deal表现费", "优惠券参与费", "SAFE-T赔偿", "可负担性费用", "预扣费用", "拒付收入", "A-Z索赔收入", "促销销售额", "促销运费", "促销税费"];
  const values = [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async () => [{ rows: [Object.fromEntries(keys.map((k, i) => [k, values[i]])), Object.fromEntries(keys.map(k => [k, null]))], total: 2, totals: [] }] } as unknown as PrismaClient;
  const url = new URL("http://localhost/?reportDate=2026-10-25");
  keys.forEach(key => url.searchParams.append("column", key));
  try {
    const query = sellfoxBrowseQuery(url), scope = { organizationId: "org", workspaceId: "ws" };
    const csv = await (await sellfoxWorkbenchExport("performance", query, scope, url)).text();
    assert.equal(csv.trim(), labels.map(l => `"${l}"`).join(",") + '\r\n' + values.join(",") + '\r\n' + keys.map(() => '""').join(","));
    url.searchParams.set("format", "xlsx");
    const response = await sellfoxWorkbenchExport("performance", query, scope, url);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), labels);
    assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), values);
    keys.forEach((_, i) => assert.ok([null, ""].includes(sheet.getRow(3).getCell(i + 1).value as null | string)));
  } finally { globals.prisma = previous; }
});
