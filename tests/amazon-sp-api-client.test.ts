import assert from "node:assert/strict";
import test from "node:test";
import { AmazonSpApiClient, AmazonSpApiError } from "@/lib/amazon/sp-api-client";
import { assertAmazonSpApiScopeAllowed, getAmazonSpApiServerConfiguration } from "@/lib/amazon/sp-api-config";

const environment = {
  AMAZON_SP_API_LWA_CLIENT_ID: "lwa-client",
  AMAZON_SP_API_LWA_CLIENT_SECRET: "lwa-secret",
  AMAZON_SP_API_REFRESH_TOKEN: "refresh-token",
  AMAZON_SP_API_AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
  AMAZON_SP_API_AWS_SECRET_ACCESS_KEY: "aws-secret",
};

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
