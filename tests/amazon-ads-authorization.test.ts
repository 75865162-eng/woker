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
