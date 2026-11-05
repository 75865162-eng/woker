import assert from "node:assert/strict";
import test from "node:test";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { requestChange } from "@/lib/amazon-sync/change-approval";
import { performAuthorizationValidation } from "@/lib/amazon-sync/service";

test("authorization verification cannot bypass an execution approval through the service", async () => {
  await assert.rejects(() => performAuthorizationValidation({ organizationId: "fixture", workspaceId: "default" }, "actor", "auth", 1), /APPROVAL_REQUIRED/);
});
test("verification and disable requests resolve Seller identity from storage without resubmitting credentials", async () => {
  const global = globalThis as { prisma?: unknown }, prior = global.prisma;
  const env = { key: process.env.AMAZON_SP_API_ENCRYPTION_KEY, environment: process.env.AMAZON_DATA_CENTER_ENVIRONMENT };
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 15).toString("base64"); process.env.AMAZON_DATA_CENTER_ENVIRONMENT = "local";
  const scope = { organizationId: "fixture", workspaceId: "default" };
  const auth = { id: "auth", name: "Fixture", amazonSellerId: "SELLER", awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", revision: 1, status: "CONFIGURED" };
  const db = {
    $executeRaw: async () => 0,
    workspaceScope: { findUnique: async () => ({ id: "default" }) },
    organizationMember: { findUnique: async () => ({ role: "owner", user: { status: "active" } }) },
    organizationRosterRole: { findMany: async () => [] },
    amazonSpApiAuthorization: { findFirst: async () => auth },
    amazonDataCenterChangeRequest: { create: async (args: { data: object }) => ({ ...args.data }) },
    amazonDataCenterSealedCommand: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
    $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(db),
  };
  global.prisma = db;
  try {
    for (const action of ["validate-authorization", "disable-authorization"]) {
      const request = await requestChange(scope, "actor", { action, id: "auth", revision: 1 });
      assert.equal(request.targetId, "auth"); assert.deepEqual(request.sellerIds, ["SELLER"]);
    }
    await assert.rejects(() => requestChange(scope, "actor", { action: "save-authorization", id: "auth", revision: 1, name: "Fixture", amazonSellerId: "CHANGED", region: "us-east-1", endpoint: auth.endpoint }), /不可原地更换/);
  } finally { global.prisma = prior; for (const [name, value] of [["AMAZON_SP_API_ENCRYPTION_KEY", env.key], ["AMAZON_DATA_CENTER_ENVIRONMENT", env.environment]]) { if (value === undefined) delete process.env[name!]; else process.env[name!] = value; } }
});


test("validation distinguishes redacted Amazon replies from network and local failures", async () => {
  const globals = globalThis as { prisma?: unknown }, priorDb = globals.prisma, priorFetch = globalThis.fetch;
  const previous = { DATABASE_URL: process.env.DATABASE_URL, AMAZON_SP_API_ENCRYPTION_KEY: process.env.AMAZON_SP_API_ENCRYPTION_KEY, AMAZON_DATA_CENTER_ENVIRONMENT: process.env.AMAZON_DATA_CENTER_ENVIRONMENT };
  delete process.env.DATABASE_URL;
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString("base64");
  process.env.AMAZON_DATA_CENTER_ENVIRONMENT = "local";
  const scope = { organizationId: "fixture", workspaceId: "default" };
  const credentials = { lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "", awsSessionToken: "" };
  const member = { userId: "actor", role: "owner", user: { status: "active" } };
  let latestCode = "";
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    organizationMember: { findUnique: async () => member, findMany: async () => [member] },
    amazonDataCenterChangeRequest: { findFirst: async () => ({ approvedByUserId: "actor" }) },
    amazonSpApiAuthorization: {
      findFirst: async () => ({ id: "auth", status: "NOT_CONFIGURED", revision: 1, awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", credentialsCiphertext: encryptAmazonSpApiCredentials(credentials, { ...scope, authorizationId: "auth" }) }),
      updateMany: async ({ data }: { data: { validationErrorCode: string } }) => { latestCode = data.validationErrorCode; return { count: 1 }; },
    },
    auditLog: { create: async () => ({}) },
  };
  try {
    for (const mode of ["lwa", "sp-api", "network", "empty-sites", "basic-success"] as const) {
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        if (mode === "basic-success") {
          if (calls === 1) {
            assert.equal(String(input), "https://api.amazon.com/auth/o2/token");
            assert.deepEqual([...new URLSearchParams(String(init?.body)).keys()].sort(), ["client_id", "client_secret", "grant_type", "refresh_token"]);
          } else {
            assert.equal(String(input), "https://sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations");
            assert.equal(init?.body, undefined);
          }
        }
        if (mode === "network") throw new Error("fixture-secret network internals");
        if (mode === "lwa") return Response.json({ error: "invalid_grant", error_description: "Refresh token invalid: fixture-refresh fixture-secret" }, { status: 400 });
        if (calls === 1) return Response.json({ access_token: "fixture-access", expires_in: 3600 });
        if (mode === "sp-api") return Response.json({ message: "Access denied fixture-access fixture-secret" }, { status: 403 });
        if (calls === 2) return Response.json({ payload: mode === "empty-sites" ? [] : [{ marketplace: { id: "ATVPDKIKX0DER", countryCode: "US" }, participation: { isParticipating: true } }] });
        throw new Error("Basic validation must never request Listings or other data");
      };
      if (mode === "basic-success") {
        assert.deepEqual(await performAuthorizationValidation(scope, "actor", "auth", 1, "approval"), { validated: true, marketplaceCount: 1 });
        assert.equal(calls, 2, "Only LWA exchange and marketplace participations may be requested");
        continue;
      }
      await assert.rejects(() => performAuthorizationValidation(scope, "actor", "auth", 1, "approval"), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.startsWith("亚马逊返回："), mode === "lwa" || mode === "sp-api");
        assert.ok(!error.message.includes("fixture-secret") && !error.message.includes("fixture-refresh") && !error.message.includes("fixture-access"));
        if (mode === "lwa") { assert.match(error.message, /400.*Refresh token invalid/); assert.match(error.message, /失败步骤：LWA/); }
        if (mode === "sp-api") { assert.match(error.message, /403.*Access denied/); assert.match(error.message, /失败步骤：Sellers.getMarketplaceParticipations/); }
        if (mode === "network") assert.match(error.message, /^连接异常：/);
        return true;
      });
      assert.equal(latestCode, mode === "lwa" || mode === "sp-api" ? "AUTH_REJECTED" : mode === "empty-sites" ? "INVALID_PARTICIPATIONS" : "VALIDATION_FAILED");
    }
  } finally {
    globals.prisma = priorDb; globalThis.fetch = priorFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
