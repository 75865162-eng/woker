import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { readSalesTraffic } from "@/lib/amazon-sync/sales-query";

// Written for separately approved disposable migration verification. Never use real credentials.
const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.AMAZON_SYNC_TEST_REDIS_DISPOSABLE !== "1" || !["127.0.0.1", "localhost"].includes(db.hostname) || db.pathname !== "/amazon_sync_test") throw new Error("Requires the disposable integration runner and isolated amazon_sync_test database");
const scope = { organizationId: `sales-fixture-${randomUUID()}`, workspaceId: "sales-test" };
const otherWorkspace = { ...scope, workspaceId: "other-workspace" };
const other = { organizationId: `sales-fixture-${randomUUID()}`, workspaceId: "sales-test" };
const originalFetch = globalThis.fetch;
const reader = randomUUID();
let sourceId = "", sellerAccountId = "", oldRun = "", newRun = "";
const marketplaceId = "ATVPDKIKX0DER";
async function source(target: typeof scope) {
  const sellerId = randomUUID(), authId = randomUUID(), actor = randomUUID();
  await prisma.sellerAccount.create({ data: { ...target, id: sellerId, accountKey: sellerId, displayName: "Fixture Seller", marketplaceCode: "US" } });
  await prisma.amazonSpApiAuthorization.create({ data: { ...target, id: authId, name: "No real credentials", status: "CONFIGURED", identityVerifiedAt: new Date(), amazonSellerId: `fixture-${authId}`, awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", credentialsCiphertext: "not-a-credential", updatedByUserId: actor } });
  return prisma.amazonSyncDataSource.create({ data: { ...target, id: randomUUID(), authorizationId: authId, sellerAccountId: sellerId, marketplaceId, resource: "sales_traffic", freshnessMinutes: 360 } });
}
async function version(target: typeof scope, src: { id: string; sellerAccountId: string }, dates: string[], status: string, finishedAt: string, units: number) {
  // Seed immutable historical fixture evidence; this does not invoke task execution or bypass its approval checks.
  const run = await prisma.amazonSyncRun.create({ data: { ...target, id: randomUUID(), sourceId: src.id, requestedByUserId: "fixture", executionVersion: 2, resource: "sales_traffic", mode: "date_range", status, finishedAt: new Date(finishedAt) } });
  await prisma.amazonSalesTrafficSnapshot.createMany({ data: dates.map(businessDate => ({ ...target, id: randomUUID(), sourceId: src.id, syncRunId: run.id, sellerAccountId: src.sellerAccountId, marketplaceId, businessDate, reportId: "fixture-report", documentId: "fixture-document", quality: "VALID", capturedAt: new Date(finishedAt), metrics: { unitsOrdered: units } })) });
  return run.id;
}
before(async () => {
  globalThis.fetch = async () => { throw new Error("External HTTP forbidden in database query fixtures"); };
  await prisma.organization.createMany({ data: [scope, other].map(s => ({ id: s.organizationId, name: "Fixture", slug: s.organizationId })) });
  await prisma.workspaceScope.createMany({ data: [scope, otherWorkspace, other].map(s => ({ organizationId: s.organizationId, id: s.workspaceId, name: "Fixture" })) });
  await prisma.user.create({ data: { id: reader, email: `${reader}@fixture.invalid`, name: "Fixture reader", passwordHash: "not-a-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  const src = await source(scope); sourceId = src.id; sellerAccountId = src.sellerAccountId;
  await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: reader, sellerAccountId } });
  oldRun = await version(scope, src, ["2026-10-01", "2026-10-02"], "SUCCEEDED", "2026-10-03T00:00:00Z", 1);
  newRun = await version(scope, src, ["2026-10-02"], "SUCCEEDED", "2026-10-04T00:00:00Z", 2);
  await version(scope, src, ["2026-10-01"], "PARTIAL_SUCCESS", "2026-10-05T00:00:00Z", 99);
  for (const target of [otherWorkspace, other]) await version(target, await source(target), ["2026-10-01"], "SUCCEEDED", "2026-10-03T00:00:00Z", 999);
});
after(async () => { globalThis.fetch = originalFetch; await prisma.$disconnect(); });

test("SQL resolves each business day independently and excludes partial and foreign scope rows", async () => {
  const result = await readSalesTraffic(scope, new URLSearchParams({ direction: "asc" }), { actor: reader });
  assert.deepEqual(result.rows.map(r => [r.businessDate, r.metrics.unitsOrdered, r.syncRunId]), [["2026-10-01", "1", oldRun], ["2026-10-02", "2", newRun]]);
  assert.equal(result.pagination.total, 2);
  assert.ok(result.rows.every(r => r.organizationId === scope.organizationId && r.workspaceId === scope.workspaceId));
});
test("SQL cutoff, task lineage, backend filters and pagination agree", async () => {
  const old = await readSalesTraffic(scope, new URLSearchParams(), { cutoff: new Date("2026-10-03T12:00:00Z"), actor: reader });
  assert.ok(old.rows.every(r => r.syncRunId === oldRun));
  const historical = await readSalesTraffic(scope, new URLSearchParams({ taskId: oldRun, from: "2026-10-02", to: "2026-10-02", sellerAccountId, marketplaceId }), { actor: reader });
  assert.equal(historical.rows.length, 1); assert.equal(historical.rows[0].metrics.unitsOrdered, "1");
  const page = await readSalesTraffic(scope, new URLSearchParams({ page: "2", direction: "asc" }), { pageSize: 1, actor: reader });
  assert.equal(page.pagination.total, 2); assert.equal(page.rows[0].businessDate, "2026-10-02");
  assert.equal((await readSalesTraffic(scope, new URLSearchParams({ keyword: "' OR 1=1 --" }), { actor: reader })).rows.length, 0);
  await assert.rejects(() => readSalesTraffic(scope, new URLSearchParams({ sellerAccountId: "foreign" }), { actor: reader }), (error: unknown) => (error as { status?: number }).status === 403);
});
test("sales excludes a wrong-domain source and purged evidence even when successful rows remain", async () => {
  try {
    await prisma.amazonSyncDataSource.update({ where: { id: sourceId }, data: { resource: "inventory" } });
    await assert.rejects(() => readSalesTraffic(scope, new URLSearchParams(), { actor: reader }), (error: unknown) => (error as { businessCode?: string }).businessCode === "DATA_SOURCE_NOT_CONFIGURED");
  } finally {
    await prisma.amazonSyncDataSource.update({ where: { id: sourceId }, data: { resource: "sales_traffic" } });
  }
  try {
    await prisma.amazonSyncRun.update({ where: { id: newRun }, data: { stage: "PURGED" } });
    assert.equal((await readSalesTraffic(scope, new URLSearchParams({ taskId: newRun }), { actor: reader })).pagination.total, 0);
  } finally {
    await prisma.amazonSyncRun.update({ where: { id: newRun }, data: { stage: "WAITING" } });
  }
});
test("database rejects duplicate day evidence and cross-workspace source/task references", async () => {
  const row = { ...scope, id: randomUUID(), sourceId, syncRunId: oldRun, sellerAccountId, marketplaceId, businessDate: "2026-10-01", reportId: "fixture", documentId: "fixture", quality: "VALID", metrics: {}, capturedAt: new Date() };
  await assert.rejects(() => prisma.amazonSalesTrafficSnapshot.create({ data: row }), (error: unknown) => (error as { code?: string }).code === "P2002");
  await assert.rejects(() => prisma.amazonSalesTrafficSnapshot.create({ data: { ...row, id: randomUUID(), workspaceId: otherWorkspace.workspaceId } }), (error: unknown) => (error as { code?: string }).code === "P2003");
});
test("scope grants enforce membership, seller tenancy and uniqueness and revocation denies SQL reads", async () => {
  const userId = randomUUID();
  await prisma.user.create({ data: { id: userId, email: `${userId}@fixture.invalid`, name: "Scoped fixture", passwordHash: "not-a-login", memberships: { create: { organizationId: scope.organizationId, role: "operations" } } } });
  await prisma.organizationRosterRole.create({ data: { id: "operations", organizationId: scope.organizationId, name: "Scoped operator", description: "Isolated scope verification", permissions: { operations: ["view"] } } });
  const query = () => readSalesTraffic(scope, new URLSearchParams(), { actor: userId });
  await assert.rejects(query, (error: unknown) => (error as { status?: number }).status === 403);
  const data = { ...scope, id: randomUUID(), userId, sellerAccountId };
  await prisma.amazonDataAccessGrant.create({ data });
  assert.equal((await query()).pagination.total, 2);
  await assert.rejects(() => prisma.amazonDataAccessGrant.create({ data: { ...data, id: randomUUID() } }), (error: unknown) => (error as { code?: string }).code === "P2002");
  await assert.rejects(() => prisma.amazonDataAccessGrant.create({ data: { ...data, id: randomUUID(), workspaceId: otherWorkspace.workspaceId } }), (error: unknown) => (error as { code?: string }).code === "P2003");
  await assert.rejects(() => prisma.amazonDataAccessGrant.create({ data: { ...data, id: randomUUID(), userId: randomUUID() } }), (error: unknown) => (error as { code?: string }).code === "P2003");
  await prisma.amazonDataAccessGrant.update({ where: { id: data.id, revision: 1 }, data: { enabled: false, revision: { increment: 1 } } });
  await assert.rejects(query, (error: unknown) => (error as { status?: number }).status === 403);
});
