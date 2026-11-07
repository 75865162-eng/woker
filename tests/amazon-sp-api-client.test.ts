import assert from "node:assert/strict";
import test from "node:test";
import { AmazonSpApiClient, AmazonSpApiError, financePaginationRejected } from "@/lib/amazon/sp-api-client";
import { assertAmazonSpApiScopeAllowed, getAmazonSpApiServerConfiguration } from "@/lib/amazon/sp-api-config";

const environment = {
  AMAZON_SP_API_LWA_CLIENT_ID: "lwa-client",
  AMAZON_SP_API_LWA_CLIENT_SECRET: "lwa-secret",
  AMAZON_SP_API_REFRESH_TOKEN: "refresh-token",
  AMAZON_SP_API_AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
  AMAZON_SP_API_AWS_SECRET_ACCESS_KEY: "aws-secret",
};
test("finance pagination diagnosis requires explicit token rejection rather than any InvalidInput", () => {
  const error = (message: string) => new AmazonSpApiError(message, { status: 400, upstreamCode: "InvalidInput" });
  assert.equal(financePaginationRejected(error("NextToken expired"), true), true);
  assert.equal(financePaginationRejected(error("NextToken invalid"), false), false);
  assert.equal(financePaginationRejected(error("Start date cannot be before 2 years"), true), false);
  assert.equal(financePaginationRejected(error("Invalid input"), true), false);
});
test("bounded report ranges send no credentials and reject unsafe server fallback", async () => {
  const url = "https://fixture.s3.amazonaws.com/report?signature=private";
  const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { fetch: async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("range"), "bytes=0-262143");
    assert.equal(headers.has("authorization"), false); assert.equal(headers.has("x-amz-access-token"), false);
    return new Response("abc", { status: 206, headers: { "content-range": "bytes 0-2/3", "content-length": "3", etag: '"fixture"' } });
  } });
  assert.equal(Buffer.from((await client.downloadReportPart({ url }, { offset: 0 })).bytes).toString(), "abc");
  const unsupported = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { fetch: async () => new Response("abc") });
  await assert.rejects(unsupported.downloadReportPart({ url }, { offset: 0 }), (error: unknown) => error instanceof AmazonSpApiError && error.upstreamCode === "REPORT_RANGE_MISMATCH" && !error.message.includes("private"));
  await assert.rejects(client.downloadReportPart({ url: "https://evil.invalid/report" }, { offset: 0 }));
});

test("report download supports a bounded override and redacts timeout details", async () => {
  const original = AbortSignal.timeout;
  const timeouts: number[] = [];
  AbortSignal.timeout = ((ms: number) => { timeouts.push(ms); return new AbortController().signal; }) as typeof AbortSignal.timeout;
  try {
    const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { fetch: async () => new Response("fixture") });
    const document = { url: "https://fixture.s3.amazonaws.com/report?signature=private" };
    assert.equal(await client.downloadReportText(document), "fixture");
    assert.equal(await client.downloadReportText(document, { timeoutMs: 90_000 }), "fixture");
    assert.equal(await client.downloadReportText(document, { timeoutMs: 999_000 }), "fixture");
    assert.deepEqual(timeouts, [30_000, 90_000, 90_000]);
    const failed = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { fetch: async () => { throw new DOMException("private signed URL", "TimeoutError"); } });
    await assert.rejects(failed.downloadReportText(document), (e: unknown) => e instanceof AmazonSpApiError && e.retryable && e.upstreamCode === "REPORT_DOWNLOAD_TIMEOUT" && !e.message.includes("private"));
  } finally { AbortSignal.timeout = original; }
});

test("download diagnostics retain only received byte count after a partial body timeout", async () => {
  let reads = 0;
  const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { fetch: async () => new Response(new ReadableStream({ pull(controller) { if (reads++ === 0) controller.enqueue(new Uint8Array([1, 2, 3])); else controller.error(new DOMException("private-signed-url", "TimeoutError")); } })) });
  await assert.rejects(client.downloadReportText({ url: "https://fixture.s3.amazonaws.com/report?private=secret" }), (e: unknown) => e instanceof AmazonSpApiError && e.downloadedBytes === 3 && e.upstreamCode === "REPORT_DOWNLOAD_TIMEOUT" && !e.message.includes("private"));
});

test("SP-API client obtains LWA token and signs the marketplace request without exposing secrets", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), {
    now: () => new Date("2026-10-22T08:00:00.000Z"),
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("api.amazon.com")) {
        return new Response(JSON.stringify({ access_token: "short-lived-token", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ payload: [{ marketplace: { id: "ATVPDKIKX0DER" } }] }), { status: 200 });
    },
  });

  const result = await client.getMarketplaceParticipations();

  assert.deepEqual(result, { payload: [{ marketplace: { id: "ATVPDKIKX0DER" } }] });
  assert.equal(calls.length, 2);
  assert.match(String(calls[1]?.init?.headers && new Headers(calls[1].init.headers).get("authorization")), /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  assert.equal(new Headers(calls[1]?.init?.headers).get("x-amz-access-token"), "short-lived-token");
  assert.equal(new Headers(calls[1]?.init?.headers).get("x-amz-date"), "20261022T080000Z");
  assert.equal(new Headers(calls[1]?.init?.headers).get("user-agent"), "amazon-ad-bulk-operation/1.0 (Language=TypeScript/5)");

  await client.getInventorySummaries({ marketplaceId: "ATVPDKIKX0DER", nextToken: "page-token" });
  const inventoryUrl = new URL(calls[2]?.url ?? "https://invalid.example");
  assert.equal(inventoryUrl.pathname, "/fba/inventory/v1/summaries");
  assert.equal(inventoryUrl.searchParams.get("granularityType"), "Marketplace");
  assert.equal(inventoryUrl.searchParams.get("marketplaceIds"), "ATVPDKIKX0DER");
  assert.equal(inventoryUrl.searchParams.get("nextToken"), "page-token");
  await client.searchListingsItems({ sellerId: "SELLER/ID", marketplaceId: "ATVPDKIKX0DER", nextToken: "next page" });
  const catalogUrl = new URL(calls[3].url);
  assert.equal(catalogUrl.pathname, "/listings/2021-08-01/items/SELLER%2FID");
  assert.equal(catalogUrl.searchParams.get("marketplaceIds"), "ATVPDKIKX0DER");
  assert.equal(catalogUrl.searchParams.get("includedData"), "summaries,fulfillmentAvailability");
  assert.equal(catalogUrl.searchParams.get("pageToken"), "next page");
  assert.equal(calls[3].init?.method, "GET");
});

test("SP-API client sanitizes an upstream error and marks throttling retryable", async () => {
  const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), {
    fetch: async (url) => String(url).includes("api.amazon.com")
      ? new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 })
      : new Response(JSON.stringify({ message: "Throttled token" }), { status: 429 }),
  });

  await assert.rejects(
    () => client.getMarketplaceParticipations(),
    (error: unknown) => error instanceof AmazonSpApiError && error.status === 429 && error.retryable && !error.message.includes(" token"),
  );
});

test("SP-API configuration rejects non-HTTPS endpoints", () => {
  assert.throws(
    () => getAmazonSpApiServerConfiguration({ ...environment, AMAZON_SP_API_ENDPOINT: "http://localhost:8080" }),
    /HTTPS/,
  );
});

test("SP-API process credentials require an exact organization and workspace binding", () => {
  const scopedEnvironment = {
    ...environment,
    AMAZON_SP_API_ALLOWED_ORGANIZATION_ID: "org-1",
    AMAZON_SP_API_ALLOWED_WORKSPACE_ID: "warehouse-us",
  };
  assert.doesNotThrow(() => assertAmazonSpApiScopeAllowed({ organizationId: "org-1", workspaceId: "warehouse-us" }, scopedEnvironment));
  assert.throws(() => assertAmazonSpApiScopeAllowed({ organizationId: "org-2", workspaceId: "warehouse-us" }, scopedEnvironment), /未获准/);
  assert.throws(() => assertAmazonSpApiScopeAllowed({ organizationId: "org-1", workspaceId: "warehouse-us" }, environment), /必须配置/);
});

test("LWA-only configuration validates and sends requests without AWS signing", async () => {
  const config = getAmazonSpApiServerConfiguration({
    AMAZON_SP_API_LWA_CLIENT_ID: "client",
    AMAZON_SP_API_LWA_CLIENT_SECRET: "secret",
    AMAZON_SP_API_REFRESH_TOKEN: "refresh",
  });
  const calls: RequestInit[] = [];
  const client = new AmazonSpApiClient(config, { fetch: async (_url, init) => {
    calls.push(init!);
    return calls.length === 1
      ? new Response(JSON.stringify({ access_token: "lwa-token", expires_in: 3600 }))
      : new Response(JSON.stringify({ payload: [] }));
  } });
  await client.getMarketplaceParticipations();
  const headers = new Headers(calls[1].headers);
  assert.equal(headers.get("x-amz-access-token"), "lwa-token");
  assert.equal(headers.get("user-agent"), "amazon-ad-bulk-operation/1.0 (Language=TypeScript/5)");
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("x-amz-security-token"), false);
});

test("LWA HTTP 400 invalid grants are terminal authorization failures without leaking credentials", async () => {
  for (const code of ["invalid_grant", "invalid_client", "unauthorized_client", "invalid_request"]) {
    let requests = 0;
    const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { fetch: async () => {
      requests++;
      return Response.json({ error: code, error_description: "refresh-token lwa-secret" }, { status: 400 });
    } });
    await assert.rejects(() => client.getMarketplaceParticipations(), (error: unknown) => {
      assert.ok(error instanceof AmazonSpApiError);
      assert.equal(error.authorizationRejected, code !== "invalid_request");
      assert.equal(error.retryable, false);
      assert.ok(!error.message.includes("refresh-token") && !error.message.includes("lwa-secret"));
      return true;
    });
    assert.equal(requests, 1);
  }
});

test("SP-API errors array is surfaced without leaking credentials", async () => {
  const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { fetch: async (url) =>
    String(url).includes("api.amazon.com")
      ? Response.json({ access_token: "token", expires_in: 3600 })
      : Response.json({ errors: [{ code: "Unauthorized", message: "Access to requested resource is denied." }] }, { status: 403 }) });
  await assert.rejects(() => client.getMarketplaceParticipations(), (error: unknown) => {
    assert.ok(error instanceof AmazonSpApiError);
    assert.match(error.message, /Access to requested resource is denied/);
    assert.match(error.message, /403/);
    return true;
  });
});

test("LWA token is reused within expiry and refreshed after expiry without changing refresh token", async () => {
  let now = new Date("2026-11-04T01:00:00Z"), refreshes = 0;
  const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { now: () => now, fetch: async (url, init) => {
    if (String(url).includes("api.amazon.com")) {
      assert.equal(new URLSearchParams(String(init?.body)).get("refresh_token"), environment.AMAZON_SP_API_REFRESH_TOKEN);
      return Response.json({ access_token: `access-${++refreshes}`, expires_in: 3600 });
    }
    assert.equal(new Headers(init?.headers).get("x-amz-access-token"), `access-${refreshes}`);
    return Response.json({ payload: [] });
  } });
  await client.getMarketplaceParticipations();
  await client.getMarketplaceParticipations();
  assert.equal(refreshes, 1);
  now = new Date("2026-11-04T02:00:01Z");
  await client.getMarketplaceParticipations();
  assert.equal(refreshes, 2);
});

test("short-lived LWA tokens are never cached beyond Amazon expiry", async () => {
  let refreshes = 0;
  const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { fetch: async url => String(url).includes("api.amazon.com")
    ? Response.json({ access_token: `short-${++refreshes}`, expires_in: 30 }) : Response.json({ payload: [] }) });
  await client.getMarketplaceParticipations(); await client.getMarketplaceParticipations();
  assert.equal(refreshes, 2);
});

test("product detail clients request only their read allowlists and encode SKU path segments", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { fetch: async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    return String(url).includes("api.amazon.com") ? Response.json({ access_token: "fixture-token", expires_in: 3600 }) : Response.json({ fixture: true });
  } });
  const listing = await client.getListingDetail({ sellerId: "SELLER", sellerSku: "sku/with space", marketplaceId: "ATVPDKIKX0DER" });
  const catalog = await client.getCatalogDetail({ asin: "B123456789", marketplaceId: "ATVPDKIKX0DER" });
  const listingUrl = new URL(calls[1].url), catalogUrl = new URL(calls[2].url);
  assert.equal(calls[1].method, "GET"); assert.equal(listingUrl.pathname, "/listings/2021-08-01/items/SELLER/sku%2Fwith%20space");
  assert.equal(listingUrl.searchParams.get("marketplaceIds"), "ATVPDKIKX0DER");
  assert.equal(listingUrl.searchParams.get("includedData"), "summaries,attributes,relationships,productTypes");
  assert.equal(catalogUrl.pathname, "/catalog/2022-04-01/items/B123456789");
  assert.equal(catalogUrl.searchParams.get("includedData"), "summaries,attributes,classifications,images,identifiers,productTypes,relationships,dimensions");
  assert.equal((listing.body as { fixture: boolean }).fixture, true); assert.equal(listing.rawBody, '{"fixture":true}');
  assert.equal((catalog.body as { fixture: boolean }).fixture, true); assert.equal(catalog.rawBody, '{"fixture":true}');
  await assert.rejects(() => client.getCatalogDetail({ asin: "bad", marketplaceId: "ATVPDKIKX0DER" }));
});

test("GZIP failure exposes only a fixed diagnostic and byte count", async () => {
  const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration(environment), { fetch: async () => new Response("invalid gzip private report") });
  await assert.rejects(client.downloadReportText({ url: "https://fixture.s3.amazonaws.com/report?private=secret", compressionAlgorithm: "GZIP" }), (e: unknown) => e instanceof AmazonSpApiError && e.upstreamCode === "REPORT_DOWNLOAD_GZIP" && e.downloadedBytes === 27 && !e.message.includes("secret"));
});
