import assert from "node:assert/strict";
import test from "node:test";
import { requestSalesExport, processSalesExport } from "@/lib/amazon-sync/exports";
import { GET, POST } from "@/app/api/operations/sync-center/exports/route";

test("sales export APIs reject unauthenticated reads, downloads and creation", async () => {
  assert.equal((await GET(new Request("http://fixture.invalid/api/operations/sync-center/exports?id=foreign&download=1"))).status, 401);
  assert.equal((await POST(new Request("http://fixture.invalid/api/operations/sync-center/exports", { method: "POST", body: "{}" }))).status, 401);
});
test("export service freezes the displayed version and filters, enforces idempotency and rechecks worker permissions", async () => {
  const global = globalThis as { prisma?: unknown }, prior = global.prisma;
  const previous = { scopes: process.env.AMAZON_SYNC_CENTER_SCOPES, driver: process.env.QUEUE_DRIVER };
  const scope = { organizationId: "export-org", workspaceId: "export-ws" }, asOf = "2026-11-01T12:00:00.000Z";
  process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId]]); process.env.QUEUE_DRIVER = "redis";
  let role = "owner", assigned = true, job: Record<string, unknown> | null = null;
  const audits: string[] = [];
  const db = {
    amazonSyncDataSource: { findMany: async () => [{ id: "source", authorization: { status: "CONFIGURED", identityVerifiedAt: new Date() } }] },
    amazonRoleDataAccessGrant: { findMany: async () => [] },
    amazonDataAccessGrant: { findMany: async () => assigned ? [{ sellerAccountId: "seller" }] : [] },
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    organizationMember: { findUnique: async () => ({ role, user: { status: "active" } }) },
    organizationRosterRole: { findMany: async () => [{ id: "read_only", permissions: { operations: ["view"] } }] },
    $executeRaw: async () => 0,
    auditLog: { create: async (args: { data: { action: string } }) => { audits.push(args.data.action); } },
    amazonDataExport: {
      findUnique: async () => job,
      create: async (args: { data: Record<string, unknown> }) => { job = { status: "QUEUED", fence: 0, ...args.data }; return job; },
      updateMany: async (args: { data: object }) => { assert.ok(job); Object.assign(job, args.data); return { count: 1 }; },
    },
    $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(db),
  };
  global.prisma = db;
  try {
    const filters = { from: "2026-10-01", to: "2026-10-31", sellerAccountId: "seller", marketplaceId: "market", direction: "asc" };
    const first = await requestSalesExport(scope, "actor", { idempotencyKey: "key", filters, asOf });
    assert.equal((job!.cutoff as Date).toISOString(), asOf); assert.deepEqual(job!.query, { ...filters, _scopeSourceIds: ["source"], _scopeAll: false, _scopeSellerIds: ["seller"] });
    assert.equal(job!.organizationId, scope.organizationId); assert.equal(job!.workspaceId, scope.workspaceId);
    assert.deepEqual(await requestSalesExport(scope, "actor", { idempotencyKey: "key", filters, asOf }), first);
    await assert.rejects(() => requestSalesExport(scope, "actor", { idempotencyKey: "key", filters: { ...filters, from: "2026-10-02" }, asOf }), /幂等键/);
    role = "read_only"; assigned = false;
    await assert.rejects(() => requestSalesExport(scope, "actor", { idempotencyKey: "other", filters }), /没有已分配/);
    await processSalesExport(first.id as string, 0);
    assert.equal(job!.status, "FAILED"); assert.ok(audits.includes("amazon.data.export.failed"));
    assert.equal("fileId" in job!, false, "revocation blocks work before querying facts or storage");
  } finally {
    global.prisma = prior;
    for (const [name, value] of [["AMAZON_SYNC_CENTER_SCOPES", previous.scopes], ["QUEUE_DRIVER", previous.driver]]) { if (value === undefined) delete process.env[name!]; else process.env[name!] = value; }
  }
});
