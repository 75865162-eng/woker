import assert from "node:assert/strict";
import test from "node:test";
import { amazonDataAccess, assertSellerAccess, sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import { assertExecutionWindow } from "@/lib/amazon-sync/execution-window";
import { amazonWorkerPolicy, workerAllows } from "@/lib/amazon-sync/worker-policy";
import { assertExportJobAccess, dispatchSalesExports } from "@/lib/amazon-sync/exports";
import { salesVersionSql } from "@/lib/amazon-sync/sales-query";
import { saveAccessGrant } from "@/lib/amazon-sync/access-management";
import { withApprovedChange } from "@/lib/amazon-sync/approved-context";
import { getAmazonSyncQueueName, amazonSyncQueueName } from "@/lib/queue/redis-queue";

const scope = { organizationId: "fixture-org", workspaceId: "fixture-ws" };
test("scope grants require a live member, workspace and exact seller; admins retain access", async () => {
  let role = "operations", active = true, workspace = true, sellers = ["seller-a"];
  const db = {
    amazonRoleDataAccessGrant: { findMany: async () => [] },
    organizationRosterRole: { findMany: async () => [{ id: "operations", permissions: { operations: ["view"] } }] },
    organizationMember: { findUnique: async (arg: { where: { organizationId_userId: { organizationId: string } } }) => { assert.equal(arg.where.organizationId_userId.organizationId, scope.organizationId); return { role, user: { status: active ? "active" : "disabled" } }; } },
    workspaceScope: { findUnique: async (arg: { where: { organizationId_id: object } }) => { assert.deepEqual(arg.where.organizationId_id, { organizationId: scope.organizationId, id: scope.workspaceId }); return workspace ? { id: scope.workspaceId } : null; } },
    amazonDataAccessGrant: { findMany: async (arg: { where: object }) => { assert.deepEqual(arg.where, { ...scope, userId: "user", enabled: true }); return sellers.map(sellerAccountId => ({ sellerAccountId })); } },
  };
  const tx = db as never;
  await assert.rejects(() => amazonDataAccess(scope, undefined, tx), /缺少/);
  assert.deepEqual(sellerAccessWhere(await amazonDataAccess(scope, "user", tx)), { sellerAccountId: { in: ["seller-a"] } });
  await assertSellerAccess(scope, "user", ["seller-a"], tx);
  await assert.rejects(() => assertSellerAccess(scope, "user", ["seller-b"], tx), /超出/);
  role = "unknown-role"; await assert.rejects(() => amazonDataAccess(scope, "user", tx), /不可访问/); role = "operations";
  sellers = []; await assert.rejects(() => amazonDataAccess(scope, "user", tx), /没有有效/);
  role = "owner"; assert.equal((await amazonDataAccess(scope, "user", tx)).allSellers, true);
  active = false; await assert.rejects(() => amazonDataAccess(scope, "user", tx), /不可访问/);
  active = true; workspace = false; await assert.rejects(() => amazonDataAccess(scope, "user", tx), /不可访问/);
});
test("grant writes require approval, scoped membership and the current revision before auditing", async () => {
  let revision = 2, enabled = true, audits = 0, sellerExists = true;
  const db = {
    organizationMember: { findUnique: async () => ({ role: "owner", user: { status: "active" } }) },
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    sellerAccount: { findFirst: async () => sellerExists ? { id: "seller-a" } : null },
    amazonDataAccessGrant: {
      findUnique: async () => ({ id: "grant-a", revision, enabled }),
      update: async (arg: { where: { revision: number }; data: { enabled: boolean } }) => {
        assert.equal(arg.where.revision, revision); revision++; enabled = arg.data.enabled;
        return { id: "grant-a", revision, enabled };
      },
    },
    auditLog: { create: async (arg: { data: { metadata: { approvalId: string } } }) => { assert.equal(arg.data.metadata.approvalId, "approval-a"); audits++; } },
  };
  const command = { userId: "member-a", sellerAccountId: "seller-a", revision: 2, enabled: false };
  await assert.rejects(() => saveAccessGrant(scope, "admin", command), /APPROVAL_REQUIRED/);
  await withApprovedChange({ tx: db as never, scope, action: "save-access-grant", approvalId: "approval-a" }, async () => {
    await saveAccessGrant(scope, "admin", command);
    assert.equal(enabled, false); assert.equal(audits, 1);
    await assert.rejects(() => saveAccessGrant(scope, "admin", command), /版本已变化/);
    sellerExists = false;
    await assert.rejects(() => saveAccessGrant(scope, "admin", { ...command, revision: 3 }), /不属于当前范围/);
    assert.equal(audits, 1);
  });
});
test("controlled queue identity is isolated and independent of allowlist order", () => {
  const keys = ["AMAZON_SYNC_WORKER_MODE", "AMAZON_SYNC_WORKER_TASK_IDS", "AMAZON_SYNC_WORKER_EXPORT_IDS"] as const;
  const prior = keys.map(key => process.env[key]);
  try {
    delete process.env.AMAZON_SYNC_WORKER_MODE;
    assert.equal(getAmazonSyncQueueName(), amazonSyncQueueName);
    process.env.AMAZON_SYNC_WORKER_MODE = "approved-only";
    process.env.AMAZON_SYNC_WORKER_TASK_IDS = '["task-b","task-a"]';
    process.env.AMAZON_SYNC_WORKER_EXPORT_IDS = '[]';
    const name = getAmazonSyncQueueName(); assert.notEqual(name, amazonSyncQueueName);
    process.env.AMAZON_SYNC_WORKER_TASK_IDS = '["task-a","task-b"]'; assert.equal(getAmazonSyncQueueName(), name);
    process.env.AMAZON_SYNC_WORKER_TASK_IDS = '["task-c"]'; assert.notEqual(getAmazonSyncQueueName(), name);
  } finally { keys.forEach((key, index) => { if (prior[index] === undefined) delete process.env[key]; else process.env[key] = prior[index]; }); }
});
test("execution windows reject missing, malformed and expired grants at the exact boundary", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  for (const frozen of [null, {}, { executionExpiresAt: "invalid" }, { executionExpiresAt: now.toISOString() }, { executionExpiresAt: "2026-11-04T00:00:00Z" }]) assert.throws(() => assertExecutionWindow(frozen, now));
  assert.doesNotThrow(() => assertExecutionWindow({ executionExpiresAt: "2026-11-05T00:00:01Z" }, now));
});
test("controlled workers reject unknown modes and empty lists and never run replenishment", () => {
  assert.deepEqual(amazonWorkerPolicy({}), { mode: "standard", runReplenishment: true });
  for (const env of [{ AMAZON_SYNC_WORKER_MODE: "other" }, { AMAZON_SYNC_WORKER_MODE: "approved-only" }, { AMAZON_SYNC_WORKER_MODE: "approved-only", AMAZON_SYNC_WORKER_TASK_IDS: "not-json" }]) assert.throws(() => amazonWorkerPolicy(env));
  const policy = amazonWorkerPolicy({ AMAZON_SYNC_WORKER_MODE: "approved-only", AMAZON_SYNC_WORKER_TASK_IDS: '["task-a"]' });
  assert.equal(policy.runReplenishment, false); assert.equal(workerAllows(policy, "task", "task-a"), true);
  assert.equal(workerAllows(policy, "task", "task-b"), false); assert.equal(workerAllows(policy, "export", "task-a"), false);
});
test("seller query restrictions are bound SQL parameters, including empty authorization", () => {
  const sql = salesVersionSql(scope, { direction: "asc" }, new Date(), { allSellers: false, sellerIds: ["allowed'"] });
  assert.ok(sql.values.includes("allowed'")); assert.ok(!sql.text.includes("allowed'"));
  const empty = salesVersionSql(scope, { direction: "asc" }, new Date(), { allSellers: false, sellerIds: [] });
  assert.ok(empty.text.includes("AND FALSE"));
});
test("twenty live exports cannot hide queued exports and recovery uses its own bounded query", async () => {
  const global = globalThis as { prisma?: unknown }, previous = global.prisma;
  const queries: unknown[] = [], queued: string[] = [], recovered: unknown[] = [];
  global.prisma = { amazonDataExport: {
    findMany: async (arg: { where: { status: string }; take: number }) => { queries.push(arg); assert.equal(arg.take, 20); return arg.where.status === "RUNNING" ? [{ id: "expired", fence: 3 }] : [{ id: "new", fence: 0 }]; },
    updateMany: async (arg: unknown) => { recovered.push(arg); return { count: 1 }; },
  } };
  try {
    await dispatchSalesExports([scope], undefined, async job => { queued.push(job.id); });
    assert.deepEqual(queued, ["new"]); assert.equal(queries.length, 2);
    assert.match(JSON.stringify(queries[0]), /leaseExpiresAt/); assert.match(JSON.stringify(recovered), /"fence":\{"increment":1\}/);
    queries.length = 0; await dispatchSalesExports([]); await dispatchSalesExports([scope], []); assert.equal(queries.length, 0);
  } finally { global.prisma = previous; }
});
test("narrowed grants cannot download an export that was created with wider permissions", async () => {
  const prior = process.env.AMAZON_SYNC_CENTER_SCOPES;
  process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId]]);
  const tx = {
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    organizationMember: { findUnique: async () => ({ role: "operations", user: { status: "active" } }) },
    amazonRoleDataAccessGrant: { findMany: async () => [] },
    organizationRosterRole: { findMany: async () => [{ id: "operations", permissions: { operations: ["view", "export"] } }] },
    amazonDataAccessGrant: { findMany: async () => [{ sellerAccountId: "seller-a" }] },
  } as never;
  try {
    await assertExportJobAccess(tx, scope, "user", { _scopeAll: false, _scopeSellerIds: ["seller-a"] });
    await assert.rejects(() => assertExportJobAccess(tx, scope, "user", { _scopeAll: true, _scopeSellerIds: [] }), /撤销/);
    await assert.rejects(() => assertExportJobAccess(tx, scope, "user", { _scopeAll: false, _scopeSellerIds: ["seller-a", "seller-b"] }), /撤销/);
    await assert.rejects(() => assertExportJobAccess(tx, scope, "user", {}), /缺少冻结/);
  } finally { if (prior === undefined) delete process.env.AMAZON_SYNC_CENTER_SCOPES; else process.env.AMAZON_SYNC_CENTER_SCOPES = prior; }
});
