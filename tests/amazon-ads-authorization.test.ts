// Cloud role for injected offline HTTP fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import test from "node:test";
import assert from "node:assert/strict";
import { decryptAmazonAdsCheckpoint, decryptAmazonAdsRefreshToken, encryptAmazonAdsCheckpoint, encryptAmazonAdsRefreshToken, hasAmazonAdsEncryptionKey } from "@/lib/amazon-ads/credentials";
import { adsRegionHosts, createAmazonAdsOAuthTransport, lwaConsentHosts, lwaTokenHosts, parseAmazonAdsProfiles } from "@/lib/amazon-ads/oauth-contract";
import { missingAmazonAdsProfileIds } from "@/lib/amazon-ads/profile-reconciliation";

const key = Buffer.alloc(32, 7).toString("base64");
const scope = { organizationId: "org-1", workspaceId: "workspace-1", authorizationId: "ads-auth-1" };

test("Ads refresh token ciphertext is scoped to organization, workspace and Ads authorization", () => {
  const env = { AMAZON_ADS_ENCRYPTION_KEY: key };
  assert.equal(hasAmazonAdsEncryptionKey(env), true);
  const encrypted = encryptAmazonAdsRefreshToken("refresh-secret", scope, env);
  assert.notEqual(encrypted, "refresh-secret");
  assert.equal(decryptAmazonAdsRefreshToken(encrypted, scope, env), "refresh-secret");
  assert.throws(() => decryptAmazonAdsRefreshToken(encrypted, { ...scope, workspaceId: "other-workspace" }, env));
  assert.throws(() => decryptAmazonAdsRefreshToken(encrypted, { ...scope, authorizationId: "sp-api-auth" }, env));
  assert.throws(() => encryptAmazonAdsRefreshToken("refresh-secret", scope, {}), /AMAZON_ADS_ENCRYPTION_KEY/);
});

test("Ads pagination checkpoint is encrypted and bound to its task", () => {
  const env = { AMAZON_ADS_ENCRYPTION_KEY: key };
  const ciphertext = encryptAmazonAdsCheckpoint({ stage: 2, cursor: "opaque-next-page", pages: 1 }, scope, "task-1", env);
  assert.deepEqual(decryptAmazonAdsCheckpoint(ciphertext, scope, "task-1", env), { stage: 2, cursor: "opaque-next-page", pages: 1 });
  assert.throws(() => decryptAmazonAdsCheckpoint(ciphertext, scope, "task-2", env));
});

test("Profile parser retains marketplace account metadata and rejects malformed or duplicate identity", () => {
  const profiles = parseAmazonAdsProfiles([{ profileId: 1234, countryCode: "US", currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: { marketplaceStringId: "ATVPDKIKX0DER", id: "acct-1", type: "seller", name: "Northstar" } }]);
  assert.equal(profiles[0].profileId, "1234");
  assert.equal(profiles[0].accountInfo?.marketplaceStringId, "ATVPDKIKX0DER");
  assert.throws(() => parseAmazonAdsProfiles([{ profileId: "bad", countryCode: "US" }]));
  assert.throws(() => parseAmazonAdsProfiles([{ profileId: "1234", countryCode: "US" }, { profileId: "1234", countryCode: "CA" }]));
  assert.throws(() => parseAmazonAdsProfiles({ profiles: [] }));
});

test("Profile reconciliation only marks missing identities in regions successfully checked", () => {
  const existing = [
    { id: "na-old", region: "NA", profileId: "100" },
    { id: "eu-old", region: "EU", profileId: "200" },
    { id: "fe-current", region: "FE", profileId: "300" },
  ];
  const discovered = [{ id: "new", region: "NA", profileId: "101" }, existing[2]];
  assert.deepEqual(missingAmazonAdsProfileIds(existing, discovered, ["NA"]), ["na-old"]);
  assert.deepEqual(missingAmazonAdsProfileIds(existing, discovered, ["NA", "EU"]), ["na-old", "eu-old"]);
  assert.deepEqual(missingAmazonAdsProfileIds(existing, discovered, ["NA", "EU", "FE"]), ["na-old", "eu-old"]);
});

test("OAuth transport uses LwA token exchange, refresh and regional Ads Profile headers without network access", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); requests.push({ url, init });
    if (url.includes("/auth/o2/token")) return Response.json({ access_token: "access", refresh_token: "refresh" });
    return Response.json([{ profileId: 91, countryCode: "JP" }]);
  };
  const transport = createAmazonAdsOAuthTransport(fetcher);
  const tokens = await transport.exchangeAuthorizationCode({ region: "FE", code: "test-code", redirectUri: "https://erp.example/api/integrations/amazon/ads/oauth/callback", clientId: "client", clientSecret: "secret" });
  assert.deepEqual(tokens, { refreshToken: "refresh", accessToken: "access" });
  assert.equal(await transport.refreshAccessToken({ region: "EU", refreshToken: tokens.refreshToken, clientId: "client", clientSecret: "secret" }), "access");
  const profiles = await transport.listProfiles({ region: "FE", clientId: "client", accessToken: tokens.accessToken });
  assert.equal(profiles[0].profileId, "91");
  assert.equal(requests[0].url, lwaTokenHosts.FE);
  assert.equal(requests[1].url, lwaTokenHosts.EU);
  assert.equal(requests[2].url, `${adsRegionHosts.FE}/v2/profiles`);
  assert.equal(new Headers(requests[2].init?.headers).get("amazon-advertising-api-scope"), null);
  assert.equal(new Headers(requests[2].init?.headers).get("amazon-advertising-api-clientid"), "client");
  assert.equal(new Headers(requests[2].init?.headers).get("authorization"), "Bearer access");
  const tokenBody = new URLSearchParams(String(requests[0].init?.body));
  assert.equal(tokenBody.get("grant_type"), "authorization_code");
  assert.equal(tokenBody.get("client_secret"), "secret");
  assert.equal(requests.length, 3);
  assert.equal(lwaConsentHosts.NA, "https://www.amazon.com/ap/oa");
  assert.equal(lwaConsentHosts.EU, "https://eu.account.amazon.com/ap/oa");
  assert.equal(lwaConsentHosts.FE, "https://apac.account.amazon.com/ap/oa");
});

test("Profile identity rejects unsafe numeric IDs rather than silently binding a rounded account", () => {
  for (const profileId of [Number.MAX_SAFE_INTEGER + 1, 1.5, -1, NaN, Infinity]) {
    assert.throws(() => parseAmazonAdsProfiles([{ profileId, countryCode: "US" }]));
  }
  assert.equal(parseAmazonAdsProfiles([{ profileId: "900719925474099312345", countryCode: "US" }])[0].profileId, "900719925474099312345");
});

test("OAuth connection errors distinguish permission, throttling and network without exposing upstream data", async () => {
  const { AmazonAdsConnectionError } = await import("@/lib/amazon-ads/oauth-contract");
  const { AdsSyncError } = await import("@/lib/amazon-ads/sync-policy");
  for (const status of [400, 401, 403, 429, 503]) {
    let calls = 0;
    const transport = createAmazonAdsOAuthTransport(async () => {
      calls++;
      return new Response("secret-token signed-url private-upstream", { status, headers: { "retry-after": "120" } });
    });
    await assert.rejects(transport.refreshAccessToken({ region: "EU", refreshToken: "private-refresh", clientId: "client", clientSecret: "private-secret" }), error => {
      assert.ok(error instanceof AmazonAdsConnectionError && error instanceof AdsSyncError);
      assert.equal(error.code, `ADS_CONNECTION_REFRESH_HTTP_${status}`);
      assert.equal(error.httpStatus, status);
      assert.equal(error.region, "EU");
      assert.equal(error.retryable, status === 429 || status >= 500);
      assert.equal(error.retryAfterMs, 120000);
      assert.doesNotMatch(String(error), /private|signed-url|secret-token/);
      return true;
    });
    assert.equal(calls, 1); // No implicit retry, including the one-time code exchange.
  }
  const failed = createAmazonAdsOAuthTransport(async () => { throw new Error("private network URL"); });
  await assert.rejects(failed.listProfiles({ region: "NA", clientId: "client", accessToken: "access" }), { code: "ADS_CONNECTION_PROFILES_NETWORK", retryable: true });
});

test("OAuth bounds actual streamed bytes and rejects malformed token/profile bodies", async () => {
  const input = { region: "NA" as const, refreshToken: "refresh", clientId: "client", clientSecret: "secret" };
  let cancelled = false;
  const oversized = createAmazonAdsOAuthTransport(async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(oversized.refreshAccessToken(input), { code: "ADS_CONNECTION_REFRESH_RESPONSE_LIMIT", retryable: false });
  assert.equal(cancelled, true);
  for (const body of ['null', '[]', '{"access_token":""}', '{"access_token":"bad\\r\\nheader"}', 'invalid-json']) {
    const transport = createAmazonAdsOAuthTransport(async () => new Response(body));
    await assert.rejects(transport.refreshAccessToken(input), { code: "ADS_CONNECTION_REFRESH_RESPONSE_INVALID" });
  }
  const profiles = createAmazonAdsOAuthTransport(async () => new Response('[{"profileId":9007199254740993,"countryCode":"US"}]'));
  await assert.rejects(profiles.listProfiles({ region: "NA", clientId: "client", accessToken: "access" }), { code: "ADS_CONNECTION_PROFILES_RESPONSE_INVALID" });
  let calls = 0;
  const transport = createAmazonAdsOAuthTransport(async () => { calls++; return Response.json([]); });
  await assert.rejects(transport.listProfiles({ region: "INVALID" as "NA", clientId: "client", accessToken: "access" }), { code: "ADS_REGION_INVALID" });
  assert.equal(calls, 0);
});

test("OAuth deadline includes a stalled response body and cancels it", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const transport = createAmazonAdsOAuthTransport(async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  })));
  const pending = transport.listProfiles({ region: "FE", clientId: "client", accessToken: "access" });
  const rejected = assert.rejects(pending, { code: "ADS_CONNECTION_PROFILES_TIMEOUT", retryable: true });
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(20000);
  await rejected;
  assert.equal(cancelled, true);
});

test("a fetcher resolving after the deadline cannot leave a late body consuming resources", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveFetch!: (value: Response) => void;
  let cancelled = false;
  const transport = createAmazonAdsOAuthTransport(() => new Promise<Response>(resolve => { resolveFetch = resolve; }));
  const pending = transport.listProfiles({ region: "NA", clientId: "client", accessToken: "access" });
  const rejected = assert.rejects(pending, { code: "ADS_CONNECTION_PROFILES_TIMEOUT" });
  t.mock.timers.tick(20000);
  await rejected;
  resolveFetch(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cancelled, true);
});
