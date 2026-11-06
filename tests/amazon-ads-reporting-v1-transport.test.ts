import assert from "node:assert/strict";
import test from "node:test";
import { campaignReportingV1Request } from "../src/lib/amazon-ads/campaign-reporting-v1-contract";
import { createReportingV1Transport, type ReportingV1CreateReport } from "../src/lib/amazon-ads/reporting-v1-transport";
import { rejectUnverifiedReportingV1Dispatch, reportingV1DispatchReadiness } from "../src/lib/amazon-ads/report-dispatch";

const report: ReportingV1CreateReport = {
  format: "GZIP_JSON",
  periods: [{ datePeriod: { startDate: "2026-11-01", endDate: "2026-11-01" } }],
  query: { fields: ["fixture.field"] },
};
const success = (status: "PENDING" | "COMPLETED" = "COMPLETED", parts: Array<{ url: string; sizeInBytes: number; urlExpirationDateTime: string }> = []) => ({
  success: [{ index: 0, report: {
    reportId: "fixture-report-1", status, format: "GZIP_JSON", creationDateTime: "2026-11-06T00:00:00Z", lastUpdatedDateTime: "2026-11-06T00:00:01Z",
    ...(status === "COMPLETED" ? { completedDateTime: "2026-11-06T00:00:01Z", completedReportParts: parts } : {}),
    periods: [{ datePeriod: { startDate: "2026-11-01", endDate: "2026-11-01" } }], query: { fields: ["fixture.field"] },
  } }],
});
const request = { region: "NA" as const, clientId: "fixture-client", accessToken: "fixture-access", advertiserAccountId: "verified-account-1", report };

test("documented SP Campaign contract passes through create transport and frozen receipt validation", async () => {
  const campaignReport = campaignReportingV1Request("2026-11-01", "2026-11-03");
  let sent: unknown;
  const transport = createReportingV1Transport(async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ success: [{ index: 0, report: {
      reportId: "fixture-campaign-report", status: "PENDING", format: campaignReport.format,
      creationDateTime: "2026-11-06T00:00:00Z", lastUpdatedDateTime: "2026-11-06T00:00:01Z",
      periods: campaignReport.periods, query: campaignReport.query,
    } }] }), { status: 207 });
  });
  const result = await transport.create({ ...request, report: campaignReport });
  assert.equal(result.outcome, "success");
  assert.deepEqual(sent, { accessRequestedAccounts: [{ advertiserAccountId: request.advertiserAccountId }], reports: [campaignReport] });

  const changedReceipt = createReportingV1Transport(async () => new Response(JSON.stringify({ success: [{ index: 0, report: {
    reportId: "fixture-campaign-report", status: "PENDING", format: campaignReport.format,
    creationDateTime: "2026-11-06T00:00:00Z", lastUpdatedDateTime: "2026-11-06T00:00:01Z",
    periods: campaignReport.periods, query: { fields: [...campaignReport.query.fields, "metric.attributedSalesSameSku" ] },
  } }] }), { status: 207 }));
  await assert.rejects(changedReceipt.create({ ...request, report: campaignReport }), { message: "ADS_REPORT_V1_RECEIPT_MISMATCH" });
});

test("Reporting v1 create uses the verified regional host, identity header, and explicit advertiser account", async () => {
  let observed: { url?: string; init?: RequestInit } = {};
  const transport = createReportingV1Transport(async (url, init) => {
    observed = { url: String(url), init };
    return new Response(JSON.stringify(success("PENDING")), { status: 207, headers: { "content-type": "application/json" } });
  });
  const result = await transport.create(request);
  assert.equal(result.outcome, "success");
  assert.equal(observed.url, "https://advertising-api.amazon.com/adsApi/v1/create/reports");
  assert.equal(new Headers(observed.init?.headers).get("Amazon-Ads-ClientId"), "fixture-client");
  assert.equal(new Headers(observed.init?.headers).get("Amazon-Advertising-API-Scope"), null);
  assert.deepEqual(JSON.parse(String(observed.init?.body)), { accessRequestedAccounts: [{ advertiserAccountId: "verified-account-1" }], reports: [report] });
  assert.equal(observed.init?.redirect, "error");
});

test("Reporting v1 retrieve validates report identity and keeps download URLs out of the safe envelope", async () => {
  const signedUrl = "https://reports.fixture.invalid/path?signature=temporary-secret";
  const transport = createReportingV1Transport(async () => new Response(JSON.stringify(success("COMPLETED", [{ url: signedUrl, sizeInBytes: 7, urlExpirationDateTime: "2026-11-07T00:00:00Z" }])), { status: 207 }));
  const result = await transport.retrieve({ region: "EU", clientId: "fixture-client", accessToken: "fixture-access", reportId: "fixture-report-1" });
  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") return;
  assert.deepEqual(result.parts.map(({ sizeInBytes, urlExpirationDateTime }) => ({ sizeInBytes, urlExpirationDateTime })), [{ sizeInBytes: 7, urlExpirationDateTime: "2026-11-07T00:00:00Z" }]);
  assert.equal(result.parts[0].url, signedUrl);
  assert.equal(JSON.stringify({ ...result, parts: result.parts.map(({ sizeInBytes, urlExpirationDateTime }) => ({ sizeInBytes, urlExpirationDateTime })) }).includes("temporary-secret"), false);
});

test("create never retries or hides an unknown remote outcome", async () => {
  const transport = createReportingV1Transport(async () => { throw new Error("fixture network failure"); });
  await assert.rejects(transport.create(request), { message: "ADS_REPORT_CREATE_RESULT_UNKNOWN" });
  const malformed = createReportingV1Transport(async () => new Response("{}", { status: 207 }));
  await assert.rejects(malformed.create(request), { message: "ADS_REPORT_CREATE_RESULT_UNKNOWN" });
});

test("download requires an explicit host allowlist, unexpired URL, and exact byte count", async () => {
  let observedRedirect: RequestRedirect | undefined;
  const transport = createReportingV1Transport(async (_url, init) => {
    observedRedirect = init?.redirect;
    return new Response("fixture", { status: 200, headers: { "content-length": "7" } });
  }, ["reports.fixture.invalid"]);
  const input = { url: "https://reports.fixture.invalid/file", expiresAt: "2099-01-01T00:00:00Z", maxBytes: 20, expectedBytes: 7 };
  assert.equal((await transport.download(input)).toString(), "fixture");
  assert.equal(observedRedirect, "error");
  await assert.rejects(transport.download({ ...input, url: "https://attacker.invalid/file" }), { message: "ADS_REPORT_DOWNLOAD_URL_REJECTED" });
  await assert.rejects(createReportingV1Transport(async () => new Response("fixture")).download(input), { message: "ADS_REPORT_DOWNLOAD_URL_REJECTED" });
  await assert.rejects(transport.download({ ...input, expiresAt: "2000-01-01T00:00:00Z" }), { message: "ADS_REPORT_DOWNLOAD_EXPIRED" });
  await assert.rejects(transport.download({ ...input, expectedBytes: 6 }), { message: "ADS_REPORT_BODY_SIZE_MISMATCH" });
});

test("Reporting v1 rejects invalid query shape and does not accept Profile ID as account identity implicitly", async () => {
  const transport = createReportingV1Transport(async () => new Response(JSON.stringify(success()), { status: 207 }));
  await assert.rejects(transport.create({ ...request, advertiserAccountId: "" }), { message: "ADS_REPORT_V1_ACCOUNT_INVALID" });
  await assert.rejects(transport.create({ ...request, report: { ...report, query: { fields: [] } } }), { message: "ADS_REPORT_V1_REQUEST_INVALID" });
  await assert.rejects(transport.retrieve({ region: "NA", clientId: "fixture", accessToken: "fixture", reportId: "" }), { message: "ADS_REPORT_V1_ID_INVALID" });
});

test("create accepts only the official bounded filter grammar and sends a defensive snapshot", async () => {
  const filter = { and: { filters: [
    { on: { comparisonOperator: "IN" as const, field: "campaign.id", not: false, values: ["c-1", "c-2"] } },
    { on: { comparisonOperator: "EQUALS" as const, field: "campaign.state", not: true, values: ["enabled"] } },
  ] } };
  let sent: unknown;
  const transport = createReportingV1Transport(async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    const receipt = success("PENDING");
    Object.assign(receipt.success[0].report.query, { filter });
    return new Response(JSON.stringify(receipt), { status: 207 });
  });
  await transport.create({ ...request, report: { ...report, query: { ...report.query, filter } } });
  assert.deepEqual((sent as { reports: Array<{ query: { filter: unknown } }> }).reports[0].query.filter, filter);
  await assert.rejects(transport.create({ ...request, report: { ...report, query: { ...report.query, filter: { on: { comparisonOperator: "CONTAINS", field: "campaign.state", not: false, values: ["enabled"] } } as never } } }), { message: "ADS_REPORT_V1_FILTER_INVALID" });
  await assert.rejects(transport.create({ ...request, report: { ...report, query: { ...report.query, filter: { and: { filters: [] } } as never } } }), { message: "ADS_REPORT_V1_FILTER_INVALID" });
});

test("invalid, cyclic and excessive filters fail before any HTTP", async () => {
  let calls = 0;
  const transport = createReportingV1Transport(async () => { calls++; throw new Error("must not fetch"); });
  const on = { comparisonOperator: "EQUALS", field: "fixture.field", not: false, values: ["one"] };
  const cycle = { and: { filters: [] as unknown[] } };
  cycle.and.filters.push(cycle);
  for (const filter of [{ and: { filters: new Array(1) } }, { on: { ...on, values: new Array(1) } }, cycle, { and: { filters: Array(11).fill({ on }) } }, { on: { ...on, values: ["one", "two"] } }, { on, extra: true }, { on: { ...on, values: ["x".repeat(513)] } }, { on: { ...on, values: ["\u0000"] } }]) {
    await assert.rejects(transport.create({ ...request, report: { ...report, query: { ...report.query, filter: filter as never } } }), { message: "ADS_REPORT_V1_FILTER_INVALID" });
  }
  assert.equal(calls, 0);
});

test("caller mutation after dispatch cannot change the sent filter or expected receipt", async () => {
  const filter = { on: { comparisonOperator: "IN" as const, field: "fixture.field", not: false, values: ["original"] } };
  const original = structuredClone(filter);
  const transport = createReportingV1Transport(async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)).reports[0].query.filter, original);
    const receipt = success("PENDING");
    Object.assign(receipt.success[0].report.query, { filter: original });
    return new Response(JSON.stringify(receipt), { status: 207 });
  });
  const pending = transport.create({ ...request, report: { ...report, query: { ...report.query, filter } } });
  filter.on.values.push("widened");
  assert.equal((await pending).outcome, "success");
});

test("create rejects changed dates, fields, format or filters in a receipt without retrying", async () => {
  const changedReceipts = [success("PENDING"), success("PENDING"), success("PENDING"), success("PENDING")];
  changedReceipts[0].success[0].report.periods[0].datePeriod.startDate = "2026-10-31";
  changedReceipts[1].success[0].report.query.fields = ["different.field"];
  changedReceipts[2].success[0].report.format = "CSV";
  Object.assign(changedReceipts[3].success[0].report.query, { filter: { on: { comparisonOperator: "IN", field: "fixture.field", not: false, values: ["other"] } } });
  let calls = 0;
  for (const receipt of changedReceipts) {
    const transport = createReportingV1Transport(async () => { calls++; return new Response(JSON.stringify(receipt), { status: 207 }); });
    await assert.rejects(transport.create(request), { message: "ADS_REPORT_V1_RECEIPT_MISMATCH" });
  }
  assert.equal(calls, changedReceipts.length);
});

test("retrieve uses the correct request body and rejects a mismatched report receipt", async () => {
  const transport = createReportingV1Transport(async (url, init) => {
    assert.equal(String(url), "https://advertising-api-fe.amazon.com/adsApi/v1/retrieve/reports");
    assert.deepEqual(JSON.parse(String(init?.body)), { reportIds: ["other-report"] });
    return new Response(JSON.stringify(success()), { status: 207 });
  });
  await assert.rejects(transport.retrieve({ ...request, region: "FE", reportId: "other-report" }), { message: "ADS_REPORT_V1_ID_MISMATCH" });
});

test("207 per-item failures are returned without raw error messages", async () => {
  const transport = createReportingV1Transport(async () => new Response(JSON.stringify({ error: [{ index: 0, errors: [{ code: "NO_PERMISSION", message: "private upstream details" }] }] }), { status: 207 }));
  const result = await transport.create(request);
  assert.deepEqual(result, { outcome: "error", errors: [{ code: "NO_PERMISSION" }] });
});

test("429 respects Retry-After for reads and leaves create outcome unknown", async () => {
  let count = 0;
  const transport = createReportingV1Transport(async () => { count++; return new Response("private", { status: 429, headers: { "retry-after": "120" } }); });
  const before = Date.now();
  await assert.rejects(transport.retrieve({ ...request, reportId: "fixture-report-1" }), error => error instanceof Error && error.message === "ADS_REPORT_THROTTLED" && "retryAt" in error && Number(error.retryAt) >= before + 120000);
  await assert.rejects(transport.create(request), { message: "ADS_REPORT_CREATE_RESULT_UNKNOWN" });
  assert.equal(count, 2, "transport must not retry internally");
});

test("abort bounds a fetcher that ignores cancellation and a never-ending stream", async () => {
  const controller = new AbortController();
  const transport = createReportingV1Transport(async () => new Promise<Response>(() => {}));
  const pending = transport.create({ ...request, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { message: "ADS_REPORT_CREATE_RESULT_UNKNOWN" });
  const streamController = new AbortController();
  let cancelCalled = false;
  const streaming = createReportingV1Transport(async () => new Response(new ReadableStream({ pull() { streamController.abort(); }, cancel() { cancelCalled = true; } }), { status: 207 }));
  await assert.rejects(streaming.retrieve({ ...request, reportId: "fixture-report-1", signal: streamController.signal }), { message: "ADS_REPORT_OPERATION_TIMEOUT" });
  assert.equal(cancelCalled, true);
});

test("oversized and redirected downloads never escape the bounded reader", async () => {
  const input = { url: "https://reports.fixture.invalid/file", expiresAt: "2099-01-01T00:00:00Z", maxBytes: 3, expectedBytes: 3 };
  const oversized = createReportingV1Transport(async () => new Response("oversized"), ["reports.fixture.invalid"]);
  await assert.rejects(oversized.download(input), { message: "ADS_REPORT_BODY_LIMIT" });
  const redirected = createReportingV1Transport(async () => new Response(null, { status: 302, headers: { location: "https://attacker.invalid" } }), ["reports.fixture.invalid"]);
  await assert.rejects(redirected.download(input), { message: "ADS_REPORT_V1_HTTP_REJECTED" });
});

test("regular worker route stays closed regardless of environment flags or configured account IDs", () => {
  assert.equal(reportingV1DispatchReadiness.liveEnabled, false);
  assert.deepEqual(reportingV1DispatchReadiness.blockers, ["DOWNLOADED_JSON_ROW_ENCODING_UNVERIFIED", "ACCOUNT_BINDING_UNVERIFIED", "DOWNLOAD_HOSTS_UNVERIFIED", "PERSISTENT_V1_RUNTIME_NOT_IMPLEMENTED"]);
  assert.throws(rejectUnverifiedReportingV1Dispatch, { message: "ADS_REPORT_V1_LIVE_DISPATCH_DISABLED" });
});
