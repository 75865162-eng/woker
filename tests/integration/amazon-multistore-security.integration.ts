import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/session";
import { runOpsCommand, parseOpsArgs } from "@/lib/operations/cli";
import { refreshDueReplenishmentPlans } from "@/lib/operations/replenishment-service";
import { GET, PATCH } from "@/app/api/operations/replenishment/route";
import { GET as download } from "@/app/api/files/[id]/download/route";
import { getStorageDriver } from "@/lib/storage";
import { readAmazonProductsForSkus } from "@/lib/operations/amazon-products";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
const uploadRoot = path.resolve(process.env.UPLOAD_DIR ?? ".");
if (process.env.AMAZON_SYNC_TEST_REDIS_DISPOSABLE !== "1" || !["127.0.0.1", "localhost"].includes(database.hostname) || database.pathname !== "/amazon_sync_test" || process.env.STORAGE_DRIVER !== "local" || !uploadRoot.startsWith(path.join(tmpdir(), "amazon-sync-integration-")) || path.basename(uploadRoot) !== "uploads") throw new Error("Use the disposable --security runner; refusing existing databases/storage");

const scope = { organizationId: `security-${randomUUID()}`, workspaceId: "main" };
const second = { ...scope, workspaceId: "second" };
const foreign = { organizationId: `foreign-${randomUUID()}`, workspaceId: "main" };
const actor = randomUUID(), peer = randomUUID(), owner = randomUUID(), foreignOwner = randomUUID();
const site = "ATVPDKIKX0DER", wrongSite = "A2EUQ1WTGCTBG2";
const sellerA = randomUUID(), sellerB = randomUUID();
const cookies = new Map<string, string>();
const originalFetch = globalThis.fetch;
let grantId = "", jobA = "", jobB = "", jobSecond = "", policyA = "", policyB = "", historicalPolicy = "";
const inputs = { lifecycle: "NEW", newProductDailyUnits: 2, productionDays: 1, domesticDays: 1, oceanDays: 1, sourceNote: "isolated human input" };
function request(user: string, workspaceId = scope.workspaceId, body?: unknown) {
  return new Request("http://localhost/api/operations/replenishment", { method: body ? "PATCH" : "GET", headers: { cookie: cookies.get(user) ?? "", "x-workspace-id": workspaceId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function cli(user: string, args: string[], target = scope) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return runOpsCommand(tx, { ...target, actorUserId: user }, parseOpsArgs(args));
  });
}
async function source(sellerAccountId: string, resource: "inventory" | "catalog", quantity: number) {
  const authorizationId = randomUUID(), sourceId = randomUUID(), runId = randomUUID();
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authorizationId, name: "fixture only", amazonSellerId: randomUUID(), awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", credentialsCiphertext: "not-a-credential", updatedByUserId: owner } });
  await prisma.amazonSyncDataSource.create({ data: { ...scope, id: sourceId, authorizationId, sellerAccountId, marketplaceId: site, resource, freshnessMinutes: 360 } });
  await prisma.amazonSyncRun.create({ data: { ...scope, id: runId, sourceId, requestedByUserId: owner, executionVersion: 2, resource, status: "SUCCEEDED", finishedAt: new Date() } });
  await prisma.amazonSyncDataSource.update({ where: { id: sourceId }, data: { activeRunId: runId, lastSuccessAt: new Date() } });
  if (resource === "inventory") await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: randomUUID(), sellerAccountId, marketplaceId: site, sellerSku: "SAME-SKU", syncRunId: runId, fulfillableQuantity: quantity, capturedAt: new Date() } });
  else await prisma.amazonCatalogSnapshot.create({ data: { ...scope, id: randomUUID(), sellerAccountId, marketplaceId: site, sellerSku: "SAME-SKU", sourceRunId: runId, asin: sellerAccountId, fieldSources: {}, capturedAt: new Date() } });
  return runId;
}
async function importJob(user: string, target: typeof scope) {
  const fileId = randomUUID(), id = randomUUID(), key = `fixture/${id}.xlsx`;
  await getStorageDriver().putBuffer({ key, buffer: Buffer.from("fixture-owned-result"), contentType: "application/octet-stream" });
  await prisma.fileObject.create({ data: { ...target, id: fileId, userId: user, originalName: "fixture.xlsx", storageKey: `fixture/${fileId}`, storageType: "local" } });
  await prisma.importJob.create({ data: { ...target, id, userId: user, fileId, type: "bulk", status: "done", resultKey: key } });
  return id;
}
before(async () => {
  globalThis.fetch = async () => { throw new Error("No external HTTP allowed in security fixtures"); };
  await prisma.organization.createMany({ data: [scope, foreign].map(s => ({ id: s.organizationId, slug: s.organizationId, name: "Security fixture" })) });
  await prisma.workspaceScope.createMany({ data: [scope, second, foreign].map(s => ({ organizationId: s.organizationId, id: s.workspaceId, name: "Fixture" })) });
  for (const [id, role, organizationId] of [[actor, "operations", scope.organizationId], [peer, "operations", scope.organizationId], [owner, "owner", scope.organizationId], [foreignOwner, "owner", foreign.organizationId]] as const) {
    await prisma.user.create({ data: { id, name: "Fixture", email: `${id}@fixture.invalid`, passwordHash: "not-a-login", memberships: { create: { organizationId, role } } } });
  }
  await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: "operations", name: "Fixture operator", description: "Isolated security test", permissions: { operations: ["view", "edit"], workspace: ["view", "export"], agents: ["view"], sellfox: ["view"] } } });
  for (const id of [actor, peer, owner, foreignOwner]) { const session = await createSession(id); cookies.set(id, `${session.sessionCookie.name}=${session.sessionCookie.value}`); }
  await prisma.sellerAccount.createMany({ data: [sellerA, sellerB].map(id => ({ ...scope, id, accountKey: id, displayName: id, marketplaceCode: "US" })) });
  await source(sellerA, "inventory", 3); await source(sellerB, "inventory", 999);
  await source(sellerA, "catalog", 3); await source(sellerB, "catalog", 999);
  grantId = randomUUID();
  await prisma.amazonDataAccessGrant.createMany({ data: [{ ...scope, id: grantId, userId: actor, sellerAccountId: sellerA }, { ...scope, id: randomUUID(), userId: peer, sellerAccountId: sellerB }] });
  for (const sellerAccountId of [sellerA, sellerB]) {
    const id = randomUUID();
    await prisma.amazonReplenishmentPolicy.create({ data: { ...scope, id, enabled: true, sellerAccountId, marketplaceId: site, sellerSku: "SAME-SKU", inputs, updatedByUserId: sellerAccountId === sellerA ? actor : peer } });
    if (sellerAccountId === sellerA) policyA = id; else policyB = id;
  }
  const historicalStoreId = randomUUID(); historicalPolicy = randomUUID();
  await prisma.sellfoxStore.create({ data: { ...scope, id: historicalStoreId, externalId: historicalStoreId, payload: {}, updatedAt: new Date() } });
  await prisma.amazonReplenishmentPolicy.create({ data: { ...scope, id: historicalPolicy, enabled: true, sellerAccountId: sellerA, marketplaceId: site, sellerSku: "HISTORY", inputs: { ...inputs, historicalSource: { storeId: historicalStoreId } }, updatedByUserId: actor } });
  jobA = await importJob(actor, scope); jobB = await importJob(peer, scope); jobSecond = await importJob(actor, second);
});
after(async () => { globalThis.fetch = originalFetch; await prisma.$disconnect(); });

test("real replenishment Route returns only the operator's granted seller", async () => {
  const result = await GET(request(actor)); assert.equal(result.status, 200);
  const payload = await result.json();
  assert.ok(payload.rows.length > 0); assert.ok(payload.rows.every((r: { sellerAccountId: string }) => r.sellerAccountId === sellerA));
  assert.ok(payload.rows.every((r: { sellerSku: string }) => r.sellerSku !== "HISTORY"), "Sellfox historical-source policies stay out of the Amazon recommendations list");
  assert.deepEqual(payload.sellerAccounts.map((r: { id: string }) => r.id), [sellerA]);
  assert.ok(!(JSON.stringify(payload).includes(sellerB)));
});
test("real PATCH rejects seller/Marketplace tampering and unknown sellers equally", async () => {
  const responses = [];
  for (const [sellerAccountId, marketplaceId] of [[sellerB, site], [randomUUID(), site], [sellerA, wrongSite]]) {
    const result = await PATCH(request(actor, scope.workspaceId, { sellerAccountId, marketplaceId, sellerSku: "SAME-SKU", enabled: true, inputs }));
    assert.equal(result.status, 403); responses.push(await result.json());
  }
  assert.deepEqual(responses[0], responses[1]); assert.deepEqual(responses[0], responses[2]);
  assert.equal((await prisma.amazonReplenishmentPolicy.findUniqueOrThrow({ where: { id: policyB } })).updatedByUserId, peer);
});
test("authorized PATCH persists with an audit in the same database", async () => {
  const result = await PATCH(request(actor, scope.workspaceId, { sellerAccountId: sellerA, marketplaceId: site, sellerSku: "SAME-SKU", enabled: true, inputs }));
  assert.equal(result.status, 200);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: scope.organizationId, userId: actor, entityId: policyA, action: "amazon.replenishment.policy.saved" } }), 1);
});

test("Amazon replenishment PATCH rejects Sellfox-bound policies", async () => {
  const result = await PATCH(request(actor, scope.workspaceId, { sellerAccountId: sellerA, marketplaceId: site, sellerSku: "SELLFOX-ONLY", enabled: true, inputs: { ...inputs, historicalSource: { storeId: "legacy-sellfox-store" } } }));
  assert.equal(result.status, 400);
  assert.match((await result.json()).error, /\/sellfox\/restock/);
  assert.equal(await prisma.amazonReplenishmentPolicy.count({ where: { ...scope, sellerSku: "SELLFOX-ONLY" } }), 0);
});
test("real read-only CLI SQL isolates identical SKUs and aggregate from ungranted seller", async () => {
  const inventory = await cli(actor, ["inventory", "list"]) as { rows: Array<{ sellerAccountId: string; fulfillableQuantity: number }> };
  assert.equal(inventory.rows.length, 1); assert.equal(inventory.rows[0].sellerAccountId, sellerA); assert.equal(inventory.rows[0].fulfillableQuantity, 3);
  const summary = await cli(actor, ["inventory", "summary"]) as { summary: { _sum: { fulfillableQuantity: number } } };
  assert.equal(summary.summary._sum.fulfillableQuantity, 3);
  const catalog = await cli(actor, ["catalog", "list"]) as { rows: Array<{ sellerAccountId: string }> };
  assert.deepEqual(catalog.rows.map(r => r.sellerAccountId), [sellerA]);
  const peerRows = await cli(peer, ["inventory", "list"]) as typeof inventory;
  assert.equal(peerRows.rows[0].fulfillableQuantity, 999, "no cross-user permissions cache");
});
test("CLI excludes incomplete, purged and wrong-domain published heads without hiding valid peer data", async () => {
  for (const resource of ["inventory", "catalog"]) {
    const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA, resource } });
    const original = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: source.activeRunId! } });
    try {
      for (const patch of [{ finishedAt: null }, { stage: "PURGED", finishedAt: original.finishedAt }, { resource: resource === "inventory" ? "catalog" : "inventory", stage: original.stage }]) {
        await prisma.amazonSyncRun.update({ where: { id: original.id }, data: patch });
        const list = await cli(actor, [resource, "list"]) as { rows: unknown[]; status: string };
        assert.deepEqual(list.rows, []); assert.equal(list.status, "NOT_SYNCED");
        if (resource === "inventory") {
          const summary = await cli(actor, ["inventory", "summary"]) as { summary: unknown };
          assert.equal(summary.summary, null);
        }
        const peerRows = await cli(peer, [resource, "list"]) as { rows: Array<{ sellerAccountId: string }> };
        assert.deepEqual(peerRows.rows.map(row => row.sellerAccountId), [sellerB]);
      }
    } finally {
      await prisma.amazonSyncRun.update({ where: { id: original.id }, data: { resource: original.resource, stage: original.stage, finishedAt: original.finishedAt } });
    }
    const restored = await cli(actor, [resource, "list"]) as { rows: Array<{ sellerAccountId: string }> };
    assert.deepEqual(restored.rows.map(row => row.sellerAccountId), [sellerA]);
  }
});
test("CLI excludes null-seller and source-less legacy evidence and hides internal task fields", async () => {
  const id = randomUUID();
  await prisma.amazonSyncRun.create({ data: { ...scope, id, requestedByUserId: actor, resource: "inventory", status: "SUCCEEDED", finishedAt: new Date(Date.now() + 1000) } });
  await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: randomUUID(), marketplaceId: site, sellerSku: "SAME-SKU", syncRunId: id, fulfillableQuantity: 777, capturedAt: new Date() } });
  const result = await cli(actor, ["inventory", "summary"]) as { summary: { _sum: { fulfillableQuantity: number } } };
  assert.equal(result.summary._sum.fulfillableQuantity, 3);
  const runs = await cli(actor, ["sync", "runs"]) as { rows: Array<Record<string, unknown>> };
  assert.equal(runs.rows.length, 2); assert.ok(runs.rows.every(r => r.id !== id && !("checkpointCiphertext" in r) && !("frozenScope" in r)));
});
test("targeted worker projection intersects the requested shop with live grants in SQL", async () => {
  const target = { sellerAccountId: sellerB, marketplaceId: site };
  assert.deepEqual(await readAmazonProductsForSkus(scope.organizationId, scope.workspaceId, ["SAME-SKU"], actor, target), []);
  const rows = await readAmazonProductsForSkus(scope.organizationId, scope.workspaceId, ["SAME-SKU"], owner, target);
  assert.equal(rows.length, 1); assert.equal(rows[0].sellerAccountId, sellerB); assert.equal(rows[0].available, 999);
});
test("other workspace and foreign organization do not inherit actor or admin permissions", async () => {
  assert.equal((await GET(request(actor, second.workspaceId))).status, 403);
  await assert.rejects(() => cli(actor, ["inventory", "list"], second));
  await assert.rejects(() => cli(owner, ["inventory", "list"], foreign));
  assert.equal((await GET(request(foreignOwner))).status, 200); // own organization: no sellers
  assert.equal((await (await GET(request(foreignOwner))).json()).rows.length, 0);
});
test("download Route returns only actor-owned job/file in the requested workspace", async () => {
  const get = (id: string, workspaceId = scope.workspaceId) => download(request(actor, workspaceId), { params: Promise.resolve({ id }) });
  const own = await get(jobA); assert.equal(own.status, 200); assert.equal(await own.text(), "fixture-owned-result"); assert.equal(own.headers.get("cache-control"), "no-store");
  for (const id of [jobB, jobSecond, randomUUID()]) assert.equal((await get(id)).status, 404);
  assert.equal((await get(jobSecond, second.workspaceId)).status, 200);
});
test("revocation blocks fresh CLI and Route calls and pending historical worker publication", async () => {
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: false } });
  assert.equal((await GET(request(actor))).status, 403);
  await assert.rejects(() => cli(actor, ["inventory", "list"]));
  await refreshDueReplenishmentPlans();
  assert.equal(await prisma.amazonReplenishmentPlan.count({ where: { policyId: { in: [policyA, historicalPolicy] } } }), 0);
  assert.equal(await prisma.amazonReplenishmentPlan.count({ where: { policyId: policyB } }), 1, "authorized peer still calculates");
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: true } });
  assert.equal((await GET(request(actor))).status, 200);
});

test("worker rechecks a grant revoked after computation but before the publication lock", async () => {
  // Hold the actual publication lock in PostgreSQL, rather than mocking a permission decision.
  await prisma.amazonReplenishmentPolicy.update({ where: { id: historicalPolicy }, data: { enabled: false } });
  let unlock = () => {}, acquired = () => {};
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const lock = prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${policyA}, 1))`;
    acquired(); await gate;
  }, { timeout: 10000 });
  await ready;
  const work = refreshDueReplenishmentPlans();
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted = false`;
      if (Number(rows[0].count) > 0) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(waiting, "the real worker reached the publication lock");
    await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: false } });
  } finally { unlock(); await lock; }
  await work;
  assert.equal(await prisma.amazonReplenishmentPlan.count({ where: { policyId: policyA } }), 0, "revoked calculation must not publish inputs or failure snapshots");
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: true } });
});

test("historical worker stops when current Sellfox module access is removed", async () => {
  await prisma.amazonReplenishmentPolicy.update({ where: { id: historicalPolicy }, data: { enabled: true } });
  await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: "operations" } }, data: { permissions: { operations: ["view", "edit"], workspace: ["view", "export"], agents: ["view"], sellfox: [] } } });
  await refreshDueReplenishmentPlans();
  assert.equal(await prisma.amazonReplenishmentPlan.count({ where: { policyId: historicalPolicy } }), 0);
  assert.equal(await prisma.amazonReplenishmentPlan.count({ where: { policyId: policyA } }), 1, "Amazon branch retains its authorized behavior");
});
