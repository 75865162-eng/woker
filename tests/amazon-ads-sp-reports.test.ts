import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, test } from "node:test";
import { AdsQueryError } from "../src/lib/amazon-ads/query-contract";
import { ReportReadRetryError } from "../src/lib/amazon-ads/report-retry";
import { createSpReportTransport } from "../src/lib/amazon-ads/reporting-v3-transport";
import {
  parseSpReportFile, spReportDefinition, spReportRequest, spReportTypeIds, spReportWindow,
} from "../src/lib/amazon-ads/sp-report-types";

const gzip = (rows: unknown) => gzipSync(Buffer.from(JSON.stringify(rows), "utf8"));

test("五类报表的 reportTypeId / groupBy 与官方报表类型页一致", () => {
  assert.deepEqual([...spReportTypeIds], ["campaign", "advertised-product", "search-term", "placement", "targeting"]);
  const expected: Record<string, [string, string[]]> = {
    campaign: ["spCampaigns", ["campaign"]],
    "advertised-product": ["spAdvertisedProduct", ["advertiser"]],
    "search-term": ["spSearchTerm", ["searchTerm"]],
    // SP 没有独立位置报表：官方要求活动报表 + groupBy campaignPlacement。
    placement: ["spCampaigns", ["campaignPlacement"]],
    targeting: ["spTargeting", ["targeting"]],
  };
  for (const type of spReportTypeIds) {
    const definition = spReportDefinition(type);
    assert.equal(definition.reportTypeId, expected[type][0]);
    assert.deepEqual([...definition.groupBy], expected[type][1]);
    assert.equal(definition.maxDays, 31);
    assert.equal(definition.timeUnit, "DAILY");
    assert.equal(definition.format, "GZIP_JSON");
    for (const metric of ["impressions", "clicks", "cost", "purchasesClicks", "salesClicks", "unitsSoldClicks"]) {
      assert.ok(definition.columns.includes(metric), `${type} 缺少 ${metric}`);
    }
  }
});

test("请求体按官方 v3 结构生成，并拒绝超过 31 天", () => {
  const request = spReportRequest("campaign", "2026-11-01", "2026-11-07");
  assert.equal(request.startDate, "2026-11-01");
  assert.equal(request.endDate, "2026-11-07");
  assert.equal(request.configuration.adProduct, "SPONSORED_PRODUCTS");
  assert.equal(request.configuration.reportTypeId, "spCampaigns");
  assert.deepEqual(request.configuration.groupBy, ["campaign"]);
  assert.equal(request.configuration.timeUnit, "DAILY");
  assert.equal(request.configuration.format, "GZIP_JSON");
  assert.throws(() => spReportRequest("campaign", "2026-09-01", "2026-11-30"), /ADS_REPORT_RANGE_EXCEEDS_TYPE_LIMIT/);
  assert.throws(() => spReportRequest("campaign", "2026-11-07", "2026-11-01"), /ADS_REPORT_DATE_RANGE_INVALID/);
});

test("默认窗口以昨天为终点，且不超过类型上限", () => {
  const now = new Date("2026-11-13T10:00:00Z");
  const window = spReportWindow("campaign", now, 90);
  assert.equal(window.to, "2026-11-12");
  assert.equal(window.from, "2026-10-13");
  const short = spReportWindow("campaign", now, 7);
  assert.equal(short.from, "2026-11-06");
});

test("活动报表解析：粒度、指标、币种校验", () => {
  const rows = [
    { date: "2026-11-10", campaignId: "111", campaignName: "A", campaignBudgetCurrencyCode: "USD", campaignStatus: "ENABLED", impressions: 1000, clicks: 25, cost: 12.345678, purchasesClicks: 3, salesClicks: 99.5, unitsSoldClicks: 3 },
    { date: "2026-11-11", campaignId: "111", campaignName: "A", campaignBudgetCurrencyCode: "USD", campaignStatus: "ENABLED", impressions: 500, clicks: 10, cost: 5, purchasesClicks: 1, salesClicks: 20, unitsSoldClicks: 1 },
  ];
  const parsed = parseSpReportFile("campaign", gzip(rows), { from: "2026-11-10", to: "2026-11-11", currencyCode: "USD" });
  assert.equal(parsed.facts.length, 2);
  assert.deepEqual(parsed.facts[0].dimensions, { campaignId: "111" });
  assert.equal(parsed.facts[0].impressions, "1000");
  assert.equal(parsed.facts[0].spend, "12.345678");
  assert.equal(parsed.facts[0].orders, "3");
  assert.equal(parsed.facts[0].sales, "99.5");
  assert.equal(parsed.facts[0].units, "3");
  assert.equal(parsed.facts[0].currencyCode, "USD");
  assert.throws(() => parseSpReportFile("campaign", gzip([{ ...rows[0], campaignBudgetCurrencyCode: "EUR" }]), { from: "2026-11-10", to: "2026-11-10", currencyCode: "USD" }), /ADS_REPORT_CURRENCY_MISMATCH/);
  assert.throws(() => parseSpReportFile("campaign", gzip([{ ...rows[0], date: "2026-10-01" }]), { from: "2026-11-10", to: "2026-11-11", currencyCode: "USD" }), /ADS_REPORT_DATE_INVALID/);
});

test("位置报表按 campaignId + placementClassification 落库", () => {
  const parsed = parseSpReportFile("placement", gzip([
    { date: "2026-11-11", campaignId: "222", campaignName: "B", campaignBudgetCurrencyCode: "USD", placementClassification: "TOP_OF_SEARCH", impressions: 300, clicks: 9, cost: 1.5, purchasesClicks: 1, salesClicks: 30, unitsSoldClicks: 1 },
    { date: "2026-11-11", campaignId: "222", campaignName: "B", campaignBudgetCurrencyCode: "USD", placementClassification: "PRODUCT_PAGE", impressions: 700, clicks: 5, cost: 0.9, purchasesClicks: 0, salesClicks: 0, unitsSoldClicks: 0 },
  ]), { from: "2026-11-11", to: "2026-11-11", currencyCode: "USD" });
  assert.deepEqual(parsed.facts.map(fact => fact.dimensions), [
    { campaignId: "222", placement: "TOP_OF_SEARCH" },
    { campaignId: "222", placement: "PRODUCT_PAGE" },
  ]);
  assert.equal(parsed.facts[0].spend, "1.5");
});

test("搜索词报表用 keywordId 区分同一搜索词，不误合并", () => {
  const parsed = parseSpReportFile("search-term", gzip([
    { date: "2026-11-11", campaignId: "1", adGroupId: "9", keywordId: "k1", keyword: "phone case", keywordType: "EXACT", matchType: "EXACT", searchTerm: "phone case", impressions: 10, clicks: 1, cost: 0.5, purchasesClicks: 1, salesClicks: 10, unitsSoldClicks: 1 },
    { date: "2026-11-11", campaignId: "1", adGroupId: "9", keywordId: "k2", keyword: "phone cases", keywordType: "BROAD", matchType: "BROAD", searchTerm: "phone case", impressions: 20, clicks: 2, cost: 0.7, purchasesClicks: 0, salesClicks: 0, unitsSoldClicks: 0 },
  ]), { from: "2026-11-11", to: "2026-11-11", currencyCode: "USD" });
  assert.equal(parsed.facts.length, 2);
  assert.deepEqual(parsed.facts[0].dimensions, { campaignId: "1", adGroupId: "9", targetingId: "k1", searchTerm: "phone case" });
  assert.deepEqual(parsed.facts[1].dimensions, { campaignId: "1", adGroupId: "9", targetingId: "k2", searchTerm: "phone case" });
});

test("投放商品报表同 ASIN 多 SKU 行按指标求和，未知列回报", () => {
  const parsed = parseSpReportFile("advertised-product", gzip([
    { date: "2026-11-11", campaignId: "1", adGroupId: "2", advertisedAsin: "B0TEST", advertisedSku: "SKU-1", impressions: 100, clicks: 4, cost: 2.25, purchasesClicks: 1, salesClicks: 10, unitsSoldClicks: 1, newColumnWeDoNotStore: 1 },
    { date: "2026-11-11", campaignId: "1", adGroupId: "2", advertisedAsin: "B0TEST", advertisedSku: "SKU-2", impressions: 50, clicks: 1, cost: 0.75, purchasesClicks: 0, salesClicks: 0, unitsSoldClicks: 0 },
  ]), { from: "2026-11-11", to: "2026-11-11", currencyCode: "USD" });
  assert.equal(parsed.facts.length, 1);
  assert.equal(parsed.mergedRows, 1);
  assert.equal(parsed.facts[0].impressions, "150");
  assert.equal(parsed.facts[0].spend, "3");
  assert.equal(parsed.facts[0].orders, "1");
  assert.deepEqual(parsed.ignoredColumns, ["newColumnWeDoNotStore"]);
});

test("定向报表把 keywordId 与 targetingId 都收进 targetingId 粒度", () => {
  const parsed = parseSpReportFile("targeting", gzip([
    { date: "2026-11-11", campaignId: "1", adGroupId: "2", targetingId: "t1", targeting: "asin=\"B0X\"", keyword: null, keywordType: "TARGETING_EXPRESSION", matchType: null, impressions: 10, clicks: 1, cost: 0.2, purchasesClicks: 0, salesClicks: 0, unitsSoldClicks: 0 },
    { date: "2026-11-11", campaignId: "1", adGroupId: "2", keywordId: "k9", keyword: "usb cable", keywordType: "EXACT", matchType: "EXACT", impressions: 5, clicks: 0, cost: 0, purchasesClicks: 0, salesClicks: 0, unitsSoldClicks: 0 },
  ]), { from: "2026-11-11", to: "2026-11-11", currencyCode: "USD" });
  assert.deepEqual(parsed.facts.map(fact => fact.dimensions.targetingId), ["t1", "k9"]);
});

test("空报表允许，坏文件被拒绝", () => {
  const empty = parseSpReportFile("campaign", gzip([]), { from: "2026-11-11", to: "2026-11-11", currencyCode: "USD" });
  assert.equal(empty.facts.length, 0);
  assert.throws(() => parseSpReportFile("campaign", Buffer.from("not gzip"), { from: "2026-11-11", to: "2026-11-11", currencyCode: "USD" }), /ADS_REPORT_GZIP_OR_JSON_INVALID/);
  assert.throws(() => parseSpReportFile("campaign", gzip([{ date: "2026-11-11" }]), { from: "2026-11-11", to: "2026-11-11", currencyCode: "USD" }), /ADS_REPORT_GRAIN_MISSING/);
});

describeTransport();

function describeTransport() {
  const original = { ...process.env };
  beforeEach(() => { process.env.AMAZON_API_EXECUTION_ROLE = "cloud"; });
  afterEach(() => { process.env = { ...original }; });

  test("创建请求带官方 Header 与 media type，并按回执解析", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const transport = createSpReportTransport(async (url, init) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ reportId: "r-1", status: "PENDING" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const receipt = await transport.create({
      region: "NA", clientId: "client", accessToken: "token", profileId: "123", advertiserAccountId: "amzn1.ads-account.g.1",
      request: spReportRequest("campaign", "2026-11-01", "2026-11-07"),
    });
    assert.equal(receipt.reportId, "r-1");
    assert.equal(receipt.status, "PENDING");
    assert.equal(captured!.url, "https://advertising-api.amazon.com/reporting/reports");
    const headers = captured!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer token");
    assert.equal(headers["Amazon-Ads-ClientId"], "client");
    assert.equal(headers["Amazon-Advertising-API-Scope"], "123");
    assert.equal(headers["Content-Type"], "application/vnd.createasyncreportrequest.v3+json");
    const body = JSON.parse(String(captured!.init.body));
    assert.equal(body.configuration.reportTypeId, "spCampaigns");
    assert.equal(body.startDate, "2026-11-01");
  });

  test("400 列错误映射为可降级重试，425 映射为节流等待，401 要求重新授权", async () => {
    const transport = (status: number, body: string, headers: Record<string, string> = {}) => createSpReportTransport(async () => new Response(body, { status, headers }));
    await assert.rejects(
      transport(400, "invalid column: advertisedSku").create({ region: "NA", clientId: "c", accessToken: "t", profileId: "1", advertiserAccountId: null, request: spReportRequest("campaign", "2026-11-01", "2026-11-02") }),
      (error: unknown) => error instanceof AdsQueryError && error.message === "ADS_REPORT_COLUMNS_REJECTED",
    );
    await assert.rejects(
      transport(425, "too early").create({ region: "NA", clientId: "c", accessToken: "t", profileId: "1", advertiserAccountId: null, request: spReportRequest("campaign", "2026-11-01", "2026-11-02") }),
      (error: unknown) => error instanceof ReportReadRetryError && error.message === "ADS_REPORT_THROTTLED",
    );
    await assert.rejects(
      transport(401, "unauthorized").create({ region: "NA", clientId: "c", accessToken: "t", profileId: "1", advertiserAccountId: null, request: spReportRequest("campaign", "2026-11-01", "2026-11-02") }),
      (error: unknown) => error instanceof AdsQueryError && error.message === "ADS_REAUTH_REQUIRED",
    );
  });

  test("完成回执必须带下载地址，非 allowlist 主机被拒绝", async () => {
    const transport = createSpReportTransport(async (url) => {
      if (String(url).includes("/reporting/reports/")) return new Response(JSON.stringify({ reportId: "r-2", status: "COMPLETED" }), { status: 200 });
      return new Response("denied", { status: 200 });
    });
    await assert.rejects(
      transport.retrieve({ region: "NA", clientId: "c", accessToken: "t", profileId: "1", reportId: "r-2" }),
      (error: unknown) => error instanceof AdsQueryError && error.message === "ADS_REPORT_ENVELOPE_INVALID",
    );
    await assert.rejects(
      transport.download({ url: "https://evil.example.com/report.gz", maxBytes: 1024 }),
      (error: unknown) => error instanceof AdsQueryError && error.message === "ADS_REPORT_DOWNLOAD_URL_REJECTED",
    );
  });
}
