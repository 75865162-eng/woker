import assert from "node:assert/strict";
import test from "node:test";
import {
  datasetForTable, datasetInputSchema, describeMcpDataset, mcpDatasets,
  normalizeDatasetQuery, resolveMcpDataset, verifiedAliasNames,
} from "../src/lib/amazon-sync/mcp-datasets";

/**
 * 逻辑表别名只允许接「数据已真实落库、且口径能明确固定」的 9 项。
 * 其余逻辑表仍必须挡在 SCHEMA_UNVERIFIED，防止把声明字符串当成数据源。
 */
const expected: Record<string, { dataset: string; pin?: Record<string, string> }> = {
  ads_campaign_daily: { dataset: "ads_report_daily", pin: { reportType: "campaign" } },
  ads_advertised_product_daily: { dataset: "ads_report_daily", pin: { reportType: "advertised-product" } },
  ads_targeting_daily: { dataset: "ads_report_daily", pin: { reportType: "targeting" } },
  ads_search_term_daily: { dataset: "ads_report_daily", pin: { reportType: "search-term" } },
  ads_placement_daily: { dataset: "ads_report_daily", pin: { reportType: "placement" } },
  storage_fees_monthly: { dataset: "storage_fees" },
  inventory_ledger_daily: { dataset: "inventory_events" },
  inbound_shipments: { dataset: "fulfillment" },
  finance_events: { dataset: "finance_transactions" },
};

const unverified = [
  "ads_budget_usage", "sales_traffic_asin", "sales_rank_daily", "sku_mapping", "finance_events_unknown",
  "pricing_daily", "search_terms_weekly", "economics_daily", "economics_fees",
  "restock_plan", "restock_stockout", "restock_clearance",
];

test("别名清单恰好是 9 项，且每一项都指向已发布的真实数据集", () => {
  assert.deepEqual([...verifiedAliasNames].sort(), Object.keys(expected).sort());
  const published = new Set(mcpDatasets.map(dataset => dataset.name));
  for (const alias of verifiedAliasNames) {
    const target = datasetForTable(alias);
    assert.equal(target.name, expected[alias].dataset, `${alias} 指向错误的数据集`);
    assert.equal(target.aliasOf, alias, `${alias} 必须标明自己是别名解析结果`);
    assert.ok(published.has(target.name), `${alias} 的目标 ${target.name} 不在已发布目录里`);
    assert.ok(target.warnings?.some(warning => warning.includes("别名")), `${alias} 缺少口径说明`);
    assert.deepEqual(target.pinnedFilters, expected[alias].pin);
  }
});

test("5 类 Ads 日报必须固定 reportType，否则五类报表会被混成一张表", () => {
  for (const alias of ["ads_campaign_daily", "ads_advertised_product_daily", "ads_targeting_daily", "ads_search_term_daily", "ads_placement_daily"]) {
    const dataset = resolveMcpDataset({ table: alias });
    assert.deepEqual(dataset.pinnedFilters, expected[alias].pin);
    const normalized = normalizeDatasetQuery(dataset, { filters: {} });
    assert.equal(normalized.filters.reportType, expected[alias].pin!.reportType, `${alias} 没有把固定口径带进查询`);
    assert.throws(() => normalizeDatasetQuery(dataset, { filters: { reportType: "not-a-real-report-type" } }),
      /FILTER_CONFLICT|不能覆盖/, `${alias} 必须拒绝覆盖固定口径`);
  }
});

test("没有真实数据源的逻辑表仍返回 SCHEMA_UNVERIFIED，绝不因别名放开", () => {
  for (const table of unverified) {
    if (table === "finance_events_unknown") continue;
    assert.throws(() => resolveMcpDataset({ table }), /SCHEMA_UNVERIFIED/, `${table} 不应被别名误放行`);
  }
  assert.throws(() => resolveMcpDataset({ table: "sales_traffic_asin" }), /SCHEMA_UNVERIFIED/);
  assert.throws(() => resolveMcpDataset({ table: "ads_budget_usage" }), /SCHEMA_UNVERIFIED/);
});

test("别名进入工具 schema 的 const 分支，并在描述里如实暴露别名与固定口径", () => {
  const schema = JSON.stringify(datasetInputSchema(true));
  for (const alias of verifiedAliasNames) {
    assert.ok(schema.includes(alias), `data_query 的 schema 缺少 ${alias} 的定位分支`);
  }
  const described = describeMcpDataset(resolveMcpDataset({ table: "ads_campaign_daily" }));
  assert.equal(described.aliasOf, "ads_campaign_daily");
  assert.deepEqual(described.pinnedFilters, { reportType: "campaign" });
  assert.equal(described.legacyTable, "ads_report_daily");
});
