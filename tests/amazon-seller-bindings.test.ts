import assert from "node:assert/strict";
import test from "node:test";
import { GET, PUT } from "@/app/api/integrations/amazon/sp-api/bindings/route";
import { PUT as saveCredentials } from "@/app/api/integrations/amazon/sp-api/credentials/route";
import { createLocalSession } from "@/lib/auth/session";
import { validateAmazonConnection } from "@/lib/operations/readiness";
import type { CurrentUser } from "@/lib/auth/session";
import { decryptAmazonSpApiCredentials, encryptAmazonSpApiCredentials, mergeAmazonSpApiSettings } from "@/lib/amazon/integration-secrets";
import { parseSellerBindings, resolveSellerBindingSource, validateSellerBindingRows, type AmazonSellerBinding } from "@/lib/amazon/seller-bindings";

const row = (overrides: Partial<AmazonSellerBinding> = {}): AmazonSellerBinding => ({
  organizationId: "org-1",
  workspaceId: "workspace-1",
  sellerAccountId: "store-1",
  marketplaceId: "ATVPDKIKX0DER",
  amazonSellerId: "SELLER-1",
  authorizedResources: ["inventory", "catalog"],
  ...overrides,
});

test("legacy seller binding JSON keeps its established shape and scopes the environment fallback", () => {
  const environmentValue = JSON.stringify([row(), row({ organizationId: "org-2", sellerAccountId: "store-2", amazonSellerId: "SELLER-2" })]);
  const result = resolveSellerBindingSource({ databaseRows: [], environmentValue, organizationId: "org-1", workspaceId: "workspace-1" });
  assert.equal(result.usingEnvironmentFallback, true);
  assert.deepEqual(result.bindings, [row()]);
});

test("database bindings take precedence over legacy environment values", () => {
  const result = resolveSellerBindingSource({ databaseRows: [row()], environmentValue: "not-json", organizationId: "org-1", workspaceId: "workspace-1" });
  assert.equal(result.usingEnvironmentFallback, false);
  assert.deepEqual(result.bindings, [row()]);
});

test("one credential scope rejects multiple Seller IDs and repeated seller-marketplace pairs", () => {
  assert.throws(() => validateSellerBindingRows([row(), row({ sellerAccountId: "store-2", amazonSellerId: "SELLER-2", marketplaceId: "A1F83G8C2ARO7P" })]), /多个 Seller ID/);
  assert.throws(() => validateSellerBindingRows([row(), row({ sellerAccountId: "store-2" })]), /不能重复绑定/);
});

test("legacy JSON validates each organization and workspace credential scope independently", () => {
  const parsed = parseSellerBindings(JSON.stringify([row(), row({ organizationId: "org-2", sellerAccountId: "store-2", amazonSellerId: "SELLER-2" })]));
  assert.equal(parsed.length, 2);
  assert.throws(() => parseSellerBindings("{bad json"), /有效 JSON/);
});

test("operations editors cannot read or write settings-only Amazon bindings", async () => {
  const previousDriver = process.env.AUTH_DRIVER;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.AUTH_DRIVER = "local";
  delete process.env.DATABASE_URL;
  try {
    const session = await createLocalSession({ id: "ops-user", organizationId: "org-1", organizationName: "ERP", role: "operations", email: "ops@example.test", name: "Ops" });
    const response = await PUT(new Request("http://localhost/api/integrations/amazon/sp-api/bindings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "x-workspace-id": "workspace-1" },
      body: JSON.stringify({ bindings: [row()] }),
    }));
    assert.equal(response.status, 403);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    if (previousDriver === undefined) delete process.env.AUTH_DRIVER;
    else process.env.AUTH_DRIVER = previousDriver;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("successful connection validation persists CONFIGURED status and lastValidatedAt", async () => {
  const envKeys = ["DATABASE_URL", "AMAZON_SP_API_LWA_CLIENT_ID", "AMAZON_SP_API_LWA_CLIENT_SECRET", "AMAZON_SP_API_REFRESH_TOKEN", "AMAZON_SP_API_AWS_ACCESS_KEY_ID", "AMAZON_SP_API_AWS_SECRET_ACCESS_KEY", "AMAZON_SP_API_ALLOWED_ORGANIZATION_ID", "AMAZON_SP_API_ALLOWED_WORKSPACE_ID"];
  const priorEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const globalObject = globalThis as typeof globalThis & { prisma?: unknown };
  const previousPrisma = globalObject.prisma;
  const previousFetch = globalThis.fetch;
  const writes: Array<{ where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const fakePrisma = {
    amazonIntegrationSecret: { findUnique: async () => null },
    amazonIntegrationConnection: { upsert: async (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => { writes.push(args); return { ...args.create, lastSyncAt: null, createdAt: new Date(), updatedAt: new Date() }; } },
    amazonSyncRun: { create: async ({ data }: { data: Record<string, unknown> }) => ({ ...data, summary: data.summary, error: null, idempotencyKey: null, startedAt: data.startedAt, finishedAt: data.finishedAt }) },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://test",
    AMAZON_SP_API_LWA_CLIENT_ID: "test-client",
    AMAZON_SP_API_LWA_CLIENT_SECRET: "test-secret",
    AMAZON_SP_API_REFRESH_TOKEN: "test-refresh",
    AMAZON_SP_API_AWS_ACCESS_KEY_ID: "test-access",
    AMAZON_SP_API_AWS_SECRET_ACCESS_KEY: "test-aws-secret",
    AMAZON_SP_API_ALLOWED_ORGANIZATION_ID: "org-1",
    AMAZON_SP_API_ALLOWED_WORKSPACE_ID: "workspace-1",
  });
  globalObject.prisma = fakePrisma;
  globalThis.fetch = async (input) => String(input).includes("api.amazon.com")
    ? new Response(JSON.stringify({ access_token: "test-access-token", expires_in: 3600 }), { status: 200 })
    : new Response(JSON.stringify({ payload: [{ marketplace: { id: "ATVPDKIKX0DER", countryCode: "US" } }] }), { status: 200 });
  try {
    const user: CurrentUser = { id: "user-1", organizationId: "org-1", organizationName: "ERP", role: "owner", email: "owner@example.test", name: "Owner" };
    const result = await validateAmazonConnection({ user, scope: { workspaceId: "workspace-1", accountId: "", marketplace: "" } });
    assert.equal(result.connection.status, "CONFIGURED");
    assert.ok(result.connection.lastValidatedAt);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.create.status, "CONFIGURED");
    assert.ok(writes[0]?.create.lastValidatedAt instanceof Date);
  } finally {
    for (const key of envKeys) {
      const previous = priorEnv[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    globalThis.fetch = previousFetch;
    if (previousPrisma === undefined) delete globalObject.prisma;
    else globalObject.prisma = previousPrisma;
  }
});

test("binding API persists and returns scoped rows without exposing process secrets", async () => {
  const previousDriver = process.env.AUTH_DRIVER;
  const previousBindings = process.env.AMAZON_SP_API_SELLER_BINDINGS;
  const globalObject = globalThis as typeof globalThis & { prisma?: unknown };
  const previousPrisma = globalObject.prisma;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.AUTH_DRIVER = "local";
  delete process.env.DATABASE_URL;
  process.env.AMAZON_SP_API_SELLER_BINDINGS = "must-not-be-used";
  const saved: AmazonSellerBinding[] = [];
  const auditRows: unknown[] = [];
  const tx = {
    amazonSellerBinding: {
      findMany: async () => [...saved],
      deleteMany: async () => { saved.splice(0); return { count: 0 }; },
      createMany: async ({ data }: { data: AmazonSellerBinding[] }) => { saved.push(...data); return { count: data.length }; },
    },
    auditLog: { create: async ({ data }: { data: unknown }) => { auditRows.push(data); return data; } },
  };
  globalObject.prisma = {
    amazonIntegrationSecret: { findUnique: async () => null },
    sellerAccount: {
      findMany: async ({ where }: { where: { id?: { in: string[] } } }) => where.id ? where.id.in.includes("store-1") ? [{ id: "store-1" }] : [] : [{ id: "store-1", displayName: "US Store", accountKey: "internal-key", marketplaceCode: "US", marketplaceId: "marketplace" }],
    },
    amazonSellerBinding: { findMany: async () => [...saved] },
    amazonIntegrationConnection: { findUnique: async () => null },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  };
  try {
    const session = await createLocalSession({ id: "owner-user", organizationId: "org-1", organizationName: "ERP", role: "owner", email: "owner@example.test", name: "Owner" });
    const headers = { "Content-Type": "application/json", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` };
    const put = await PUT(new Request("http://localhost/api/integrations/amazon/sp-api/bindings", { method: "PUT", headers, body: JSON.stringify({ bindings: [{ ...row(), organizationId: "forged", workspaceId: "forged" }] }) }));
    assert.equal(put.status, 200);
    assert.equal(saved[0]?.organizationId, "org-1");
    assert.equal(saved[0]?.workspaceId, "default");
    assert.equal(auditRows.length, 1);
    assert.equal(JSON.stringify(auditRows).includes("must-not-be-used"), false);
    const get = await GET(new Request("http://localhost/api/integrations/amazon/sp-api/bindings", { headers: { cookie: headers.cookie } }));
    const payload = await get.json() as { bindings: { sellerAccountId: string; marketplaceId: string; amazonSellerId: string; authorizedResources: string[]; active: boolean }[]; runtimeConfiguration: { configured: boolean } };
    assert.equal(get.status, 200);
    assert.deepEqual(payload.bindings, [{ sellerAccountId: "store-1", marketplaceId: "ATVPDKIKX0DER", amazonSellerId: "SELLER-1", authorizedResources: ["inventory", "catalog"], active: true }]);
    assert.equal(payload.runtimeConfiguration.configured, false);
    assert.match(get.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    if (previousDriver === undefined) delete process.env.AUTH_DRIVER; else process.env.AUTH_DRIVER = previousDriver;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousBindings === undefined) delete process.env.AMAZON_SP_API_SELLER_BINDINGS; else process.env.AMAZON_SP_API_SELLER_BINDINGS = previousBindings;
    if (previousPrisma === undefined) delete globalObject.prisma; else globalObject.prisma = previousPrisma;
  }
});

test("SP-API credentials use authenticated encryption scoped to organization and workspace", () => {
  const scope = { organizationId: "org-1", workspaceId: "workspace-1" };
  const key = { AMAZON_SP_API_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
  const credentials = { lwaClientId: "client-id-secret", lwaClientSecret: "lwa-secret", refreshToken: "refresh-secret", awsAccessKeyId: "access-id", awsSecretAccessKey: "aws-secret", awsSessionToken: undefined };
  const ciphertext = encryptAmazonSpApiCredentials(credentials, scope, key);
  assert.equal(ciphertext.includes(credentials.lwaClientId), false);
  assert.deepEqual(decryptAmazonSpApiCredentials(ciphertext, scope, key), credentials);
  assert.throws(() => decryptAmazonSpApiCredentials(ciphertext, { ...scope, workspaceId: "other-workspace" }, key), /无法解密/);
  assert.throws(() => encryptAmazonSpApiCredentials(credentials, scope, {}), /AMAZON_SP_API_ENCRYPTION_KEY/);
});

test("credential API stores ciphertext and returns no submitted secret values", async () => {
  const previousDriver = process.env.AUTH_DRIVER;
  const previousKey = process.env.AMAZON_SP_API_ENCRYPTION_KEY;
  const globalObject = globalThis as typeof globalThis & { prisma?: unknown };
  const previousPrisma = globalObject.prisma;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.AUTH_DRIVER = "local";
  delete process.env.DATABASE_URL;
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
  let stored: Record<string, unknown> | null = null;
  const audits: Array<{ metadata?: unknown }> = [];
  const tx = {
    amazonIntegrationSecret: { upsert: async ({ create }: { create: Record<string, unknown> }) => { stored = create; return create; } },
    amazonIntegrationConnection: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async ({ data }: { data: { metadata?: unknown } }) => { audits.push(data); return data; } },
  };
  globalObject.prisma = {
    amazonIntegrationSecret: { findUnique: async () => stored, findFirst: async () => null },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  };
  try {
    const session = await createLocalSession({ id: "owner-user", organizationId: "org-1", organizationName: "ERP", role: "owner", email: "owner@example.test", name: "Owner" });
    const secretValues = ["client-secret-value", "lwa-secret-value", "refresh-secret-value", "access-id-value", "aws-secret-value"];
    const response = await saveCredentials(new Request("http://localhost/api/integrations/amazon/sp-api/credentials", {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` },
      body: JSON.stringify({ lwaClientId: secretValues[0], lwaClientSecret: secretValues[1], refreshToken: secretValues[2], region: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com" }),
    }));
    const responseText = await response.text();
    const persistedRecord = stored as Record<string, unknown> | null;
    assert.equal(response.status, 200);
    assert.equal(secretValues.some((value) => responseText.includes(value)), false);
    assert.equal(typeof persistedRecord?.credentialsCiphertext, "string");
    assert.equal(secretValues.some((value) => (persistedRecord?.credentialsCiphertext as string).includes(value)), false);
    assert.equal(secretValues.some((value) => JSON.stringify(audits).includes(value)), false);
  } finally {
    if (previousDriver === undefined) delete process.env.AUTH_DRIVER; else process.env.AUTH_DRIVER = previousDriver;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousKey === undefined) delete process.env.AMAZON_SP_API_ENCRYPTION_KEY; else process.env.AMAZON_SP_API_ENCRYPTION_KEY = previousKey;
    if (previousPrisma === undefined) delete globalObject.prisma; else globalObject.prisma = previousPrisma;
  }
});


test("LWA-only credentials round-trip and blank submissions retain saved secrets", () => {
  const scope = { organizationId: "org-1", workspaceId: "workspace-1" };
  const key = { AMAZON_SP_API_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
  const settings = mergeAmazonSpApiSettings(null, { lwaClientId: "client", lwaClientSecret: "secret", refreshToken: "refresh" });
  const decrypted = decryptAmazonSpApiCredentials(encryptAmazonSpApiCredentials(settings, scope, key), scope, key);
  assert.equal(decrypted.awsAccessKeyId, "");
  assert.equal(decrypted.awsSecretAccessKey, "");
  assert.equal(mergeAmazonSpApiSettings(decrypted, { lwaClientSecret: "", refreshToken: "new-refresh" }).lwaClientSecret, "secret");
  assert.equal(mergeAmazonSpApiSettings(decrypted, { refreshToken: "new-refresh" }).refreshToken, "new-refresh");
  assert.throws(() => mergeAmazonSpApiSettings(null, { lwaClientId: "client" }), /Client Secret/);
});
