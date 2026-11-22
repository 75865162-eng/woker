// 免审批「保存即激活」：验证保存授权后直接真实校验站点并置 CONFIGURED，不产生任何审批请求。
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import assert from "node:assert/strict";
import test from "node:test";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { saveAndActivateAuthorizationDirect, enableAndActivateAuthorizationDirect } from "@/lib/amazon-sync/direct-activation";

function withPrisma(db: unknown, run: () => Promise<void>): Promise<void> {
  const g = globalThis as { prisma?: unknown }, prior = g.prisma;
  g.prisma = db;
  return run().finally(() => { g.prisma = prior; });
}

test("saving an authorization activates directly with NO approval request and NO manual validate step", async () => {
  const prev = { DATABASE_URL: process.env.DATABASE_URL, KEY: process.env.AMAZON_SP_API_ENCRYPTION_KEY, ENV: process.env.AMAZON_DATA_CENTER_ENVIRONMENT };
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.AMAZON_DATA_CENTER_ENVIRONMENT = "local";
  const scope = { organizationId: "fixture", workspaceId: "default" };
  const member = { userId: "actor", role: "owner", user: { status: "active" } };
  let approvalRequests = 0;
  let status = "NOT_CONFIGURED";
  let revision = 1;
  const stored = { id: "auth", name: "Direct", amazonSellerId: "A1TESTSELLER", awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", revision: 1, status: "CONFIGURED", marketplaceParticipations: [{ marketplaceId: "ATVPDKIKX0DER", countryCode: "US" }], rolesAttestedAt: null, lastValidatedAt: new Date(), validationAttemptedAt: new Date(), validationErrorCode: null, updatedAt: new Date() };
  const db = {
    $executeRaw: async () => 0,
    $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(db),
    amazonSyncDataSource: { count: async () => 0, findMany: async () => [] },
    amazonSyncSchedule: { count: async () => 0 },
    workspaceScope: { findUnique: async () => ({ id: "default" }) },
    organizationMember: { findUnique: async () => member, findMany: async () => [member] },
    organizationRosterRole: { findMany: async () => [] },
    amazonSpApiAuthorization: {
      findFirst: async () => ({ ...stored, status, revision, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "c", lwaClientSecret: "s", refreshToken: "r", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId: "auth" }) }),
      findMany: async () => [], // 初始化阶段：无自动连接候选 → no_eligible_sources，不深入调度器
      findUniqueOrThrow: async () => stored,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.status === "string") status = data.status;
        if (typeof data.revision === "object" && data.revision && "increment" in data.revision) revision += 1;
        return { count: 1 };
      },
      create: async () => ({}),
    },
    amazonDataCenterChangeRequest: { create: async () => { approvalRequests++; return {}; } },
    amazonDataCenterSealedCommand: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
  };
  const priorFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ access_token: "at", expires_in: 3600 });
    return Response.json({ payload: [{ marketplace: { id: "ATVPDKIKX0DER", countryCode: "US" }, participation: { isParticipating: true } }] });
  };
  try {
    await withPrisma(db, async () => {
      const result = await saveAndActivateAuthorizationDirect(scope, "actor", {
        action: "save-authorization", id: "auth", revision: 1, name: "Direct", amazonSellerId: "A1TESTSELLER",
        region: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com",
        lwaClientId: "c", lwaClientSecret: "s", refreshToken: "r",
      });
      assert.equal(result.activated, true);
      assert.equal(status, "CONFIGURED", "保存后应直接置为 CONFIGURED，无需人工验证");
      assert.equal(approvalRequests, 0, "保存即激活不得创建任何审批请求");
      assert.equal(calls, 2, "只调用 LWA 换取令牌 + 参与站点查询");
      assert.ok(["database_unavailable", "no_eligible_sources"].includes(result.automaticSync.status), "初始化被短路，不深入调度器");
    });
  } finally {
    globalThis.fetch = priorFetch;
    for (const [k, v] of [["DATABASE_URL", prev.DATABASE_URL], ["AMAZON_SP_API_ENCRYPTION_KEY", prev.KEY], ["AMAZON_DATA_CENTER_ENVIRONMENT", prev.ENV]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("re-enable activates directly with NO approval request (no manual validate dead-end)", async () => {
  const prev = { KEY: process.env.AMAZON_SP_API_ENCRYPTION_KEY, ENV: process.env.AMAZON_DATA_CENTER_ENVIRONMENT };
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.AMAZON_DATA_CENTER_ENVIRONMENT = "local";
  const scope = { organizationId: "fixture", workspaceId: "default" };
  const member = { userId: "actor", role: "owner", user: { status: "active" } };
  let approvalRequests = 0, status = "DISABLED", revision = 1;
  const stored = { id: "auth", status: "CONFIGURED", revision: 2 };
  const db = {
    $executeRaw: async () => 0,
    $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(db),
    amazonSyncDataSource: { count: async () => 0, findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    amazonSyncSchedule: { count: async () => 0 },
    workspaceScope: { findUnique: async () => ({ id: "default" }) },
    organizationMember: { findUnique: async () => member, findMany: async () => [member] },
    organizationRosterRole: { findMany: async () => [] },
    amazonSpApiAuthorization: {
      findFirst: async () => ({ ...stored, status, revision, awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "c", lwaClientSecret: "s", refreshToken: "r", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId: "auth" }) }),
      findMany: async () => [],
      findUniqueOrThrow: async () => stored,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.status === "string" && data.status !== "DISABLED") status = data.status as string;
        if (typeof data.revision === "object" && data.revision && "increment" in data.revision) revision += 1;
        return { count: 1 };
      },
    },
    amazonDataCenterChangeRequest: { create: async () => { approvalRequests++; return {}; } },
    amazonDataCenterSealedCommand: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
  };
  const priorFetch = globalThis.fetch;
  let enableCalls = 0;
  globalThis.fetch = async () => {
    enableCalls++;
    if (enableCalls === 1) return Response.json({ access_token: "at", expires_in: 3600 });
    return Response.json({ payload: [{ marketplace: { id: "ATVPDKIKX0DER", countryCode: "US" }, participation: { isParticipating: true } }] });
  };
  try {
    await withPrisma(db, async () => {
      const result = await enableAndActivateAuthorizationDirect(scope, "actor", "auth", 1);
      assert.equal(result.activated, true);
      assert.equal(approvalRequests, 0, "重新启用不得创建审批请求");
      assert.equal(status, "CONFIGURED", "重新启用后应自动验证并置 CONFIGURED，不留 NOT_CONFIGURED 死状态");
    });
  } finally {
    globalThis.fetch = priorFetch;
    for (const [k, v] of [["AMAZON_SP_API_ENCRYPTION_KEY", prev.KEY], ["AMAZON_DATA_CENTER_ENVIRONMENT", prev.ENV]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
