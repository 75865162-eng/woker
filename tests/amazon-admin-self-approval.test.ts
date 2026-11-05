import assert from "node:assert/strict";
import test from "node:test";
import type { AmazonDataCenterChangeRequest } from "@prisma/client";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";

const scope = { organizationId: "fixture-org", workspaceId: "fixture-ws" };
const command = { action: "save-authorization", name: "Fixture", amazonSellerId: "FIXTURE-SELLER", region: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", lwaClientId: "mock-client", lwaClientSecret: "mock-secret", refreshToken: "mock-refresh" };

// In-memory delegates only: no Prisma connection, real credentials or HTTP.
async function fixture(work: (state: ReturnType<typeof mockDatabase>) => Promise<void>) {
  const globals = globalThis as { prisma?: unknown }, previous = globals.prisma;
  const previousFetch = globalThis.fetch;
  const env = { AMAZON_SYNC_CENTER_SCOPES: process.env.AMAZON_SYNC_CENTER_SCOPES, AMAZON_SP_API_ENCRYPTION_KEY: process.env.AMAZON_SP_API_ENCRYPTION_KEY, AMAZON_DATA_CENTER_ENVIRONMENT: process.env.AMAZON_DATA_CENTER_ENVIRONMENT };
  const state = mockDatabase();
  globals.prisma = state.db;
  globalThis.fetch = async () => { throw new Error("External HTTP forbidden"); };
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64");
  process.env.AMAZON_DATA_CENTER_ENVIRONMENT = "local";
  process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId]]);
  try { await work(state); } finally {
    globals.prisma = previous; globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
function mockDatabase() {
  const state = { role: "owner", active: true, canApprove: true, workspace: true, member: true, row: undefined as AmazonDataCenterChangeRequest | undefined, envelope: null as { ciphertext: string } | null, saved: 0, savedSellerId: undefined as string | undefined, envelopeReads: 0, audits: [] as Array<{ action: string; metadata: Record<string, unknown> }> };
  const db = {
    $executeRaw: async () => 0,
    workspaceScope: { findUnique: async () => state.workspace ? { id: scope.workspaceId } : null },
    organizationMember: { findUnique: async () => state.member ? { role: state.role, user: { status: state.active ? "active" : "disabled" } } : null },
    organizationRosterRole: { findMany: async () => [{ id: state.role, permissions: { operations: state.canApprove ? ["view", "create", "edit", "approve"] : ["view", "create", "edit"] } }] },
    amazonDataAccessGrant: { findMany: async () => [{ sellerAccountId: "fixture-seller", marketplaceIds: [], actions: ["view", "sync"] }] },
    amazonRoleDataAccessGrant: { findMany: async () => [] },
    amazonSpApiAuthorization: {
      findFirst: async () => null,
      create: async ({ data }: { data: { amazonSellerId: string } }) => { state.saved++; state.savedSellerId = data.amazonSellerId; return {}; },
      findUniqueOrThrow: async () => ({ id: "saved-fixture" }),
    },
    amazonDataCenterChangeRequest: {
      create: async ({ data }: { data: object }) => (state.row = { status: "REQUESTED", approvedByUserId: null, decidedAt: null, decisionReason: null, appliedAt: null, createdAt: new Date(), ...data } as AmazonDataCenterChangeRequest),
      findFirst: async () => state.row,
      findFirstOrThrow: async () => state.row!,
      updateMany: async ({ where, data }: { where: { status?: string; id?: string | { not: string } }; data: object }) => {
        if (!state.row || (typeof where.id === "object" && where.id.not === state.row.id) || (typeof where.status === "string" && state.row.status !== where.status)) return { count: 0 };
        Object.assign(state.row, data); return { count: 1 };
      },
      update: async ({ data }: { data: object }) => Object.assign(state.row!, data),
    },
    amazonDataCenterSealedCommand: {
      create: async ({ data }: { data: { ciphertext: string } }) => (state.envelope = data),
      findFirst: async () => { state.envelopeReads++; return state.envelope; },
      delete: async () => { state.envelope = null; },
      deleteMany: async () => { state.envelope = null; },
    },
    amazonDataCenterConfigVersion: { create: async () => ({}) },
    auditLog: { create: async ({ data }: { data: { action: string; metadata: Record<string, unknown> } }) => { state.audits.push(data); return {}; } },
    $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(db),
  };
  return Object.assign(state, { db });
}

test("basic connection saves without Seller ID and never substitutes the display name or calls Amazon", async () => fixture(async state => {
  const { amazonSellerId: omitted, ...basic } = command;
  void omitted;
  const change = await requestChange(scope, "admin", basic), id = String(change.id);
  await decideChange(scope, "admin", id, "APPROVED", "Basic connection fixture");
  await applyChange(scope, "admin", id);
  assert.equal(state.saved, 1);
  assert.equal(state.savedSellerId, "");
}));

for (const role of ["owner", "database_admin"]) test(`${role} can explicitly approve own authorization; only application saves it and replay fails`, async () => fixture(async state => {
  state.role = role;
  const change = await requestChange(scope, "admin", command), id = String(change.id);
  await assert.rejects(() => applyChange(scope, "admin", id));
  assert.equal(state.saved, 0);
  const approved = await decideChange(scope, "admin", id, "APPROVED", "Reviewed fixture");
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.approvedByUserId, "admin");
  assert.equal(state.saved, 0);
  assert.ok(state.audits.some(a => a.action.endsWith(".approved") && a.metadata.selfApproved === true && a.metadata.approverRole === role));
  state.canApprove = false;
  await assert.rejects(() => applyChange(scope, "admin", id), /操作权限不足/);
  assert.equal(state.saved, 0);
  state.canApprove = true;
  await applyChange(scope, "admin", id);
  assert.equal(state.saved, 1);
  assert.equal(state.row?.status, "APPLIED");
  await assert.rejects(() => applyChange(scope, "admin", id));
  assert.equal(state.saved, 1);
}));

test("self confirmation resolves live membership, role, approval permission and workspace", async () => fixture(async state => {
  const change = await requestChange(scope, "admin", command), id = String(change.id);
  state.canApprove = false;
  await assert.rejects(() => decideChange(scope, "admin", id, "APPROVED", ""), /操作权限不足/);
  state.canApprove = true; state.active = false;
  await assert.rejects(() => decideChange(scope, "admin", id, "APPROVED", ""), /操作权限不足/);
  state.active = true; state.member = false;
  await assert.rejects(() => decideChange(scope, "admin", id, "APPROVED", ""), /操作权限不足/);
  state.member = true; state.workspace = false;
  await assert.rejects(() => decideChange(scope, "admin", id, "APPROVED", ""), /工作区不可访问/);
  state.workspace = true; state.role = "operations";
  await assert.rejects(() => decideChange(scope, "admin", id, "APPROVED", ""), /仅限组织管理员/);
  state.row!.operation = "run";
  await assert.rejects(() => decideChange(scope, "admin", id, "APPROVED", ""), /仅组织所有者或数据库管理员可确认自己的请求/);
  assert.equal(state.row?.status, "REQUESTED");
  assert.equal(state.saved, 0);
}));


test("consumed validation requests report state before missing payload; approved payload corruption still blocks", async () => fixture(async state => {
  const change = await requestChange(scope, "admin", command), id = String(change.id);
  const row = state.row!;
  row.operation = "validate-authorization";
  row.approvedByUserId = "admin";
  state.envelope = null;
  for (const [status, message] of [["FAILED", /本次授权验证已失败/], ["APPLYING", /正在执行/], ["APPLIED", /已完成/], ["REQUESTED", /尚未批准/], ["STALE", /已失效/], ["REVOKED", /已失效/]] as const) {
    row.status = status;
    await assert.rejects(() => applyChange(scope, "admin", id), message);
    assert.equal(state.envelopeReads, 0);
    assert.equal(state.saved, 0);
    assert.equal(row.status, status);
  }
  row.status = "APPROVED";
  await assert.rejects(() => applyChange(scope, "admin", id), /待应用授权验证完整性校验失败/);
  state.envelope = { ciphertext: "tampered-fixture" };
  await assert.rejects(() => applyChange(scope, "admin", id), /待应用授权验证完整性校验失败/);
  assert.equal(state.envelopeReads, 2);
  assert.equal(row.status, "APPROVED");
  assert.equal(state.saved, 0);
}));
