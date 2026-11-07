import assert from "node:assert/strict";
import test from "node:test";

test("text report decoding honors declared Cp1252 and refuses unsupported encodings", async () => {
  const client = new AmazonSpApiClient(config, { fetch: async () => new Response(new Uint8Array([99, 97, 102, 233]), { headers: { "content-type": "text/plain; charset=Cp1252" } }) });
  assert.equal(await client.downloadReportText({ url: "https://s3.amazonaws.com/fixture" }), "café");
  const unsupported = new AmazonSpApiClient(config, { fetch: async () => new Response("fixture", { headers: { "content-type": "text/plain; charset=unknown" } }) });
  await assert.rejects(unsupported.downloadReportText({ url: "https://s3.amazonaws.com/fixture" }), /字符编码不支持/);
});
import { gzipSync } from "node:zlib";
import { AmazonSpApiClient } from "@/lib/amazon/sp-api-client";
import { getAmazonSpApiServerConfiguration } from "@/lib/amazon/sp-api-config";
import { localDate, resolveRequestedRange, zonedMidnight } from "@/lib/amazon-sync/date-range";
import { parseSalesTraffic, salesTrafficReportType } from "@/lib/amazon-sync/sales-traffic";
import { parseSalesQuery, salesVersionSql } from "@/lib/amazon-sync/sales-query";
import { normalizeCommand, digest, summary } from "@/lib/amazon-sync/approval-policy";
const site = "ATVPDKIKX0DER", now = new Date("2026-11-04T12:00:00Z");
const range = resolveRequestedRange(site, { dateFrom: "2026-11-01", dateTo: "2026-11-02" }, now);
const report = () => ({ reportSpecification: { reportType: salesTrafficReportType, marketplaceIds: [site], dataStartTime: range.startAt, dataEndTime: range.reportEndAt, reportOptions: { dateGranularity: "DAY", asinGranularity: "CHILD" } }, salesAndTrafficByDate: ["2026-11-01", "2026-11-02"].map(date => ({ date, salesByDate: { unitsOrdered: 0, totalOrderItems: 0, orderedProductSales: { amount: 0, currencyCode: "USD" } }, trafficByDate: { sessions: 0, pageViews: 0 } })), salesAndTrafficByAsin: [{ childAsin: "SHOULD_NOT_BE_DAILY", salesByAsin: { unitsOrdered: 99 } }] });
const config = getAmazonSpApiServerConfiguration({ AMAZON_SP_API_LWA_CLIENT_ID: "fixture-client", AMAZON_SP_API_LWA_CLIENT_SECRET: "fixture-secret", AMAZON_SP_API_REFRESH_TOKEN: "fixture-refresh" });

test("report range uses Marketplace days across both DST transitions and inclusive end dates", () => {
  assert.equal(zonedMidnight("2026-03-08", "America/Los_Angeles"), "2026-03-08T08:00:00.000Z");
  assert.equal(zonedMidnight("2026-03-09", "America/Los_Angeles"), "2026-03-09T07:00:00.000Z");
  assert.equal(range.startAt, "2026-11-01T07:00:00.000Z");
  assert.equal(range.endExclusive, "2026-11-03T08:00:00.000Z");
  assert.equal(range.reportEndAt, "2026-11-03T07:59:59.000Z");
  assert.equal(range.periodClosed, true);
  assert.equal(localDate(new Date("2026-11-04T02:00:00Z"), "America/Los_Angeles"), "2026-11-03");
  assert.equal(resolveRequestedRange("A1VC38T7YXB528", { datePreset: "yesterday" }, now).from, "2026-11-03");
  assert.equal(resolveRequestedRange(site, { datePreset: "lastMonth" }, now).from, "2026-10-01");
  assert.equal(resolveRequestedRange(site, { datePreset: "lastMonth" }, now).to, "2026-10-31");
  assert.equal(resolveRequestedRange(site, { datePreset: "last7" }, now).from, "2026-10-29");
});
test("unsupported sites, invalid calendar dates, future and oversized historical windows fail closed", () => {
  for (const input of [{ dateFrom: "2026-02-30", dateTo: "2026-03-01" }, { dateFrom: "2026-11-05", dateTo: "2026-11-05" }, { dateFrom: "2026-09-01", dateTo: "2026-11-01" }, { dateFrom: "2022-01-01", dateTo: "2022-01-02" }]) assert.throws(() => resolveRequestedRange(site, input, now));
  assert.throws(() => resolveRequestedRange("unverified-site", { datePreset: "today" }, now));
  assert.throws(() => resolveRequestedRange(site, { datePreset: "invented" }, now));
});
test("daily report preserves genuine zeros, rejects wrong report/site/window and never splits ASIN totals", () => {
  const parsed = parseSalesTraffic(report(), range, site);
  assert.equal(parsed.complete, true); assert.equal(parsed.rows.length, 2); assert.equal(parsed.rows[0].metrics.unitsOrdered, 0);
  assert.ok(!JSON.stringify(parsed).includes("SHOULD_NOT_BE_DAILY"));
  for (const patch of [{ reportType: "OTHER" }, { marketplaceIds: ["OTHER"] }, { dataEndTime: "2026-11-01" }, { reportOptions: { dateGranularity: "WEEK", asinGranularity: "CHILD" } }]) assert.throws(() => parseSalesTraffic({ ...report(), reportSpecification: { ...report().reportSpecification, ...patch } }, range, site));
  assert.equal(parseSalesTraffic({ ...report(), reportSpecification: { ...report().reportSpecification, dataStartTime: range.from, dataEndTime: range.to } }, range, site).complete, true);
});
test("DAY response accepts the exact UTC calendar request and rejects adjacent or shifted windows", () => {
  const specification = { ...report().reportSpecification, dataStartTime: `${range.from}T00:00:00Z`, dataEndTime: `${range.to}T23:59:59Z` };
  assert.equal(parseSalesTraffic({ ...report(), reportSpecification: specification }, range, site).complete, true);
  for (const patch of [{ dataStartTime: "2026-10-31T00:00:00Z" }, { dataEndTime: "2026-11-03T23:59:59Z" }, { dataStartTime: "2026-11-01T01:00:00Z" }]) {
    assert.throws(() => parseSalesTraffic({ ...report(), reportSpecification: { ...specification, ...patch } }, range, site), /日期范围/);
  }
});
test("missing days or metrics remain incomplete and null, duplicate dates and invalid metrics reject", () => {
  const missing = report(); missing.salesAndTrafficByDate.pop();
  const parsed = parseSalesTraffic(missing, range, site); assert.equal(parsed.complete, false); assert.deepEqual(parsed.missingDates, ["2026-11-02"]);
  const absent = report(); delete (absent.salesAndTrafficByDate[0].salesByDate as Partial<{ unitsOrdered: number }>).unitsOrdered;
  const partial = parseSalesTraffic(absent, range, site); assert.equal(partial.rows[0].metrics.unitsOrdered, null); assert.equal(partial.complete, false);
  const duplicate = report(); duplicate.salesAndTrafficByDate.push(duplicate.salesAndTrafficByDate[0]); assert.throws(() => parseSalesTraffic(duplicate, range, site), /重复/);
  const invalid = report(); invalid.salesAndTrafficByDate[0].trafficByDate.sessions = -1; assert.throws(() => parseSalesTraffic(invalid, range, site));
  const openRange = { ...range, periodClosed: false }; assert.equal(parseSalesTraffic(report(), openRange, site).complete, false);
});
test("date selection survives sealed-command normalization and changes the approval digest", () => {
  const normalized = normalizeCommand({ action: "run", sourceIds: ["source"], datePreset: "custom", dateFrom: range.from, dateTo: range.to, requestedRanges: { attacker: true } });
  assert.equal(normalized.dateFrom, range.from); assert.equal("requestedRanges" in normalized, false);
  assert.notEqual(digest(normalized), digest({ ...normalized, dateTo: "2026-11-03" }));
  assert.deepEqual(summary({ ...normalized, requestedRanges: { source: range } }).requestedRanges, { source: range });
});
test("real Reports transport sends frozen dates and uses independent authenticated report operations", async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const client = new AmazonSpApiClient(config, { fetch: async (input, init) => { const url = new URL(String(input)); calls.push({ url, init }); return url.hostname === "api.amazon.com" ? Response.json({ access_token: "fixture-access", expires_in: 3600 }) : Response.json({ reportId: "r" }); } });
  await client.createSalesTrafficReport({ marketplaceId: site, ...range }); await client.getReport("r/id"); await client.getReportDocument("doc/id");
  const body = JSON.parse(calls[1].init?.body as string); assert.equal(body.dataStartTime, `${range.from}T00:00:00Z`); assert.equal(body.dataEndTime, `${range.to}T23:59:59Z`); assert.deepEqual(body.marketplaceIds, [site]);
  assert.equal(calls[1].url.pathname, "/reports/2021-06-30/reports"); assert.equal(calls[2].url.pathname, "/reports/2021-06-30/reports/r%2Fid"); assert.equal(calls[3].url.pathname, "/reports/2021-06-30/documents/doc%2Fid");
});
test("presigned report download omits credentials, refuses SSRF and handles bounded gzip", async () => {
  let calls = 0;
  const client = new AmazonSpApiClient(config, { fetch: async (_url, init) => { calls++; assert.equal(init?.headers, undefined); assert.equal(init?.redirect, "error"); return new Response(gzipSync(JSON.stringify(report()))); } });
  assert.deepEqual(await client.downloadReportDocument({ url: "https://bucket.s3.us-east-1.amazonaws.com/file?X-Amz-Signature=private", compressionAlgorithm: "GZIP" }), report());
  for (const url of ["http://bucket.s3.amazonaws.com/file", "https://127.0.0.1/private", "https://s3.amazonaws.com.evil.invalid/file", "https://user:pass@s3.amazonaws.com/file", "https://s3.amazonaws.com:444/file"]) await assert.rejects(() => client.downloadReportDocument({ url }));
  assert.equal(calls, 1);
  await assert.rejects(() => client.downloadReportDocument({ url: "https://s3.amazonaws.com/file", compressionAlgorithm: "ZIP" }));
});
test("report downloads reject oversized compressed and decoded payloads without leaking signed URLs", async () => {
  const client = new AmazonSpApiClient(config, { fetch: async () => new Response("", { headers: { "content-length": String(17 * 1024 * 1024) } }) });
  await assert.rejects(() => client.downloadReportDocument({ url: "https://s3.amazonaws.com/file?SECRET_SIGNED_URL=secret" }), error => { assert.ok(error instanceof Error); assert.ok(!error.message.includes("SECRET_SIGNED_URL")); return true; });
  const oversized = new AmazonSpApiClient(config, { fetch: async () => new Response(gzipSync(Buffer.alloc(17 * 1024 * 1024, 32))) });
  await assert.rejects(() => oversized.downloadReportDocument({ url: "https://s3.amazonaws.com/file", compressionAlgorithm: "GZIP" }));
});
test("business queries retain tenant predicates and parameterize search/date/version filters", () => {
  const q = parseSalesQuery(new URLSearchParams({ from: range.from, to: range.to, keyword: "' OR true --", taskId: "task", direction: "asc" }));
  const sql = salesVersionSql({ organizationId: "org-a", workspaceId: "ws-a" }, q, now);
  assert.ok(sql.values.includes("org-a") && sql.values.includes("ws-a") && sql.values.includes("' OR true --"));
  assert.ok(!sql.text.includes("' OR true --")); assert.match(sql.text, /DISTINCT ON/); assert.match(sql.text, /t.status = 'SUCCEEDED'/);
  for (const input of ([{ sku: "SKU" }, { asin: "ASIN" }, { from: "2026-02-30" }, { direction: "DESC; DROP" }, { status: "FAILED" }, { quality: "INCOMPLETE" }] as Array<Record<string, string>>)) assert.throws(() => parseSalesQuery(new URLSearchParams(input)));
});
