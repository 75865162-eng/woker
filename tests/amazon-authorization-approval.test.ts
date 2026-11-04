import assert from "node:assert/strict";
import test from "node:test";
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
