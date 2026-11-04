import { createSession } from "@/lib/auth/session";
import { POST as credentialPost } from "@/app/api/operations/amazon-mcp/route";
import { PATCH as storePatch } from "@/app/api/operations/amazon-stores/route";
import { POST as oauthStart } from "@/app/api/integrations/amazon/sp-api/oauth/start/route";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { manageMcpCredential, authenticateAmazonMcp, invokeAmazonMcp } from "@/lib/amazon-sync/mcp";
import { amazonDataAccess, assertSellerMarketplaceAccess } from "@/lib/amazon-sync/data-access";
import { POST } from "@/app/api/mcp/amazon/route";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { auditAmazonLineage } from "@/lib/amazon-sync/lineage-audit";
import { readTaskSnapshot } from "@/lib/amazon-sync/snapshots";
import { publishedSnapshotScopes } from "@/lib/amazon-sync/read";
import { renameAmazonStore, listAmazonStores } from "@/lib/amazon-sync/stores";
import { assertExportJobAccess } from "@/lib/amazon-sync/exports";
import { startAmazonOAuth, finishAmazonOAuth } from "@/lib/amazon-sync/oauth";

if (process.env.AMAZON_SYNC_TEST_REDIS_DISPOSABLE !== "1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable runner required");
const scope = { organizationId: randomUUID(), workspaceId: "main" }, other = { organizationId: randomUUID(), workspaceId: "main" };
const actor = randomUUID(), peer = randomUUID(), owner = randomUUID(), sellerA = randomUUID(), sellerB = randomUUID();
const site = "ATVPDKIKX0DER", ca = "A2EUQ1WTGCTBG2";
let grantId = "", token = "", credentialId = "", runA = "";
const originalFetch = globalThis.fetch;
const tools = ["amazon.stores.list", "amazon.inventory.list", "amazon.inventory.summary", "amazon.catalog.list", "amazon.sales.list", "amazon.sync.status", "amazon.history.read", "amazon.sales.export"];
async function call(tool: string, args = {}, bearer = token) { return invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${bearer}`), tool, args); }
async function seed(sellerAccountId: string, qty: number) {
  const auth = randomUUID(), amazonSellerId = `SELLER${qty}FIXTURE`;
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: auth, name: "synthetic", amazonSellerId, awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", credentialsCiphertext: "not-real", updatedByUserId: owner, status: "CONFIGURED", identityVerifiedAt: new Date(), identityEvidence: "FIXTURE" } });
  await prisma.amazonSellerIdentity.create({ data: { ...scope, id: randomUUID(), sellerAccountId, marketplaceId: site, amazonSellerId, region: "us-east-1", authorizationId: auth, verifiedAt: new Date() } });
  let inventory = "";
  for (const resource of ["inventory", "catalog", "sales_traffic"]) {
    const sourceId = randomUUID(), runId = randomUUID();
    await prisma.amazonSyncDataSource.create({ data: { ...scope, id: sourceId, authorizationId: auth, sellerAccountId, marketplaceId: site, resource, freshnessMinutes: 360, enabled: true } });
    await prisma.amazonSyncRun.create({ data: { ...scope, id: runId, sourceId, resource, mode: resource === "sales_traffic" ? "date_range" : "snapshot", requestedByUserId: owner, executionVersion: 2, status: "SUCCEEDED", finishedAt: new Date() } });
    await prisma.amazonSyncDataSource.update({ where: { id: sourceId }, data: { activeRunId: runId, lastSuccessAt: new Date() } });
    if (resource === "inventory") { inventory = runId; await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: randomUUID(), sellerAccountId, marketplaceId: site, sellerSku: "SAME-SKU", fulfillableQuantity: qty, syncRunId: runId, capturedAt: new Date() } }); }
    if (resource === "catalog") await prisma.amazonCatalogSnapshot.create({ data: { ...scope, id: randomUUID(), sellerAccountId, marketplaceId: site, sellerSku: "SAME-SKU", sourceRunId: runId, fieldSources: {}, capturedAt: new Date() } });
    if (resource === "sales_traffic") await prisma.amazonSalesTrafficSnapshot.create({ data: { ...scope, id: randomUUID(), sellerAccountId, marketplaceId: site, sourceId, syncRunId: runId, businessDate: new Date().toISOString().slice(0, 10), reportId: "fixture", documentId: "fixture", metrics: { unitsOrdered: qty }, quality: "VALID", capturedAt: new Date() } });
  }
  return inventory;
}
before(async () => {
  globalThis.fetch = async () => { throw new Error("External HTTP forbidden in fixtures"); };
  for (const s of [scope, other]) { await prisma.organization.create({ data: { id: s.organizationId, name: "Fixture", slug: s.organizationId } }); await prisma.workspaceScope.create({ data: { organizationId: s.organizationId, id: s.workspaceId, name: "Fixture" } }); }
  for (const [id, role] of [[actor, "operations"], [peer, "operations"], [owner, "owner"]] as const) await prisma.user.create({ data: { id, name: "Fixture", email: `${id}@fixture.invalid`, passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role } } } });
  await prisma.organizationRosterRole.create({ data: { organizationId: scope.organizationId, id: "operations", name: "Fixture", description: "Fixture", permissions: { operations: ["view", "create", "edit", "export"] } } });
  for (const id of [sellerA, sellerB]) await prisma.sellerAccount.create({ data: { ...scope, id, accountKey: id, displayName: "ERP custom name", marketplaceCode: "US" } });
  runA = await seed(sellerA, 3); await seed(sellerB, 999);
  grantId = (await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: actor, sellerAccountId: sellerA, marketplaceIds: [site], actions: ["view", "export"], mcpEnabled: true } })).id;
  await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: peer, sellerAccountId: sellerB, marketplaceIds: [site], actions: ["view"], mcpEnabled: true } });
  const created = await manageMcpCredential(scope, actor, { action: "create", name: "own fixture", scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], tools, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  token = created.token!; credentialId = created.credential.id;
});
after(async () => { globalThis.fetch = originalFetch; await prisma.$disconnect(); });
test("MCP personal hash only; metadata never includes plaintext", async () => {
  const row = await prisma.amazonMcpCredential.findUniqueOrThrow({ where: { id: credentialId } });
  assert.notEqual(row.tokenHash, token); assert.equal(row.tokenHash.length, 64); assert.ok(!JSON.stringify(row).includes(token));
});
test("all real MCP read tools and identical SKUs stay inside seller A", async () => {
  for (const tool of tools.filter(t => t !== "amazon.history.read")) { const result = await call(tool); assert.ok(!JSON.stringify(result).includes(sellerB), tool); }
  const rows = await call("amazon.inventory.list") as { rows: { sellerSku: string; fulfillableQuantity: number }[] };
  assert.equal(rows.rows.length, 1); assert.equal(rows.rows[0].sellerSku, "SAME-SKU"); assert.equal(rows.rows[0].fulfillableQuantity, 3);
});
test("seller tampering and unknown seller have identical errors on every tool", async () => {
  for (const tool of tools) for (const id of [sellerB, randomUUID()]) await assert.rejects(() => call(tool, { sellerAccountId: id }), /数据范围不可访问/);
});
test("site tampering and every multi-seller request are checked", async () => {
  await assert.rejects(() => call("amazon.inventory.list", { marketplaceId: ca }), /不可访问/);
  await assert.rejects(() => call("amazon.inventory.list", { sellerAccountIds: [sellerA, sellerB] }), /不可访问/);
});
test("workspace, organization, user and actual Seller ID injection denied", async () => {
  for (const key of ["workspaceId", "organizationId", "userId", "amazonSellerId"]) await assert.rejects(() => call("amazon.stores.list", { [key]: other.organizationId }), /不可访问/);
});
test("aggregate and export contain exactly authorized quantities", async () => {
  const sum = await call("amazon.inventory.summary") as { summary: { _sum: { fulfillableQuantity: number } } }; assert.equal(sum.summary._sum.fulfillableQuantity, 3);
  const output = await call("amazon.sales.export") as { rowCount: number; content: string }; assert.equal(output.rowCount, 1); assert.equal(JSON.parse(output.content).metrics.unitsOrdered, 3);
});
test("history is scoped and unpublished/unknown history never leaks", async () => {
  const result = await call("amazon.history.read", { taskId: runA }); assert.ok(JSON.stringify(result).includes("SAME-SKU"));
  const foreign = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, source: { sellerAccountId: sellerB } } });
  await assert.rejects(() => call("amazon.history.read", { taskId: foreign.id }), /不可访问/);
});
test("ERP revocation invalidates an already authenticated identity immediately", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: false } });
  await assert.rejects(() => invokeAmazonMcp(identity, "amazon.inventory.list", {}), /授权|不可访问/);
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: true } });
});
test("credential revocation rechecked even with cached identity", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { status: "REVOKED" } });
  await assert.rejects(() => invokeAmazonMcp(identity, "amazon.inventory.list", {}), /不可访问/);
  await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { status: "ACTIVE" } });
});
test("site and export/sync actions cannot inherit view grants", async () => {
  await assert.rejects(() => assertSellerMarketplaceAccess(scope, actor, sellerA, site, prisma, "sync"));
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { actions: ["view"] } });
  await assert.rejects(() => call("amazon.sales.export"));
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { actions: ["view", "export"] } });
});
test("role grants union with user grants but credential scope remains a ceiling", async () => {
  const roleGrant = await prisma.amazonRoleDataAccessGrant.create({ data: { ...scope, id: randomUUID(), roleId: "operations", sellerAccountId: sellerB, marketplaceIds: [site], actions: ["view"], mcpEnabled: true } });
  assert.ok((await amazonDataAccess(scope, actor)).sellerIds.includes(sellerB));
  await assert.rejects(() => call("amazon.inventory.list", { sellerAccountId: sellerB }));
  await prisma.amazonRoleDataAccessGrant.delete({ where: { id: roleGrant.id } });
});
test("admin cannot cross organizations or mint implicit MCP superuser", async () => {
  await assert.rejects(() => amazonDataAccess(other, owner));
  await assert.rejects(() => manageMcpCredential(scope, owner, { action: "create", name: "bad", scopes: [{ sellerAccountId: sellerB, marketplaceIds: [site] }], tools, expiresAt: new Date(Date.now() + 86400000).toISOString() }));
});
test("unverified identity and invalid published head fail closed", async () => {
  const identity = await prisma.amazonSellerIdentity.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA } });
  await prisma.amazonSpApiAuthorization.update({ where: { id: identity.authorizationId }, data: { identityVerifiedAt: null } });
  await assert.rejects(() => call("amazon.inventory.list"));
  await prisma.amazonSpApiAuthorization.update({ where: { id: identity.authorizationId }, data: { identityVerifiedAt: new Date() } });
  await prisma.amazonSyncRun.update({ where: { id: runA }, data: { status: "FAILED" } });
  assert.equal((await call("amazon.inventory.list") as { rows: unknown[] }).rows.length, 0);
  await prisma.amazonSyncRun.update({ where: { id: runA }, data: { status: "SUCCEEDED" } });
  const original = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: runA } });
  try {
    for (const patch of [{ finishedAt: null }, { stage: "PURGED", finishedAt: original.finishedAt }]) {
      await prisma.amazonSyncRun.update({ where: { id: runA }, data: patch });
      assert.equal((await call("amazon.inventory.list") as { rows: unknown[] }).rows.length, 0);
      assert.equal((await call("amazon.inventory.summary") as { summary: { _count: { _all: number } } }).summary._count._all, 0);
      assert.equal((await publishedSnapshotScopes(scope, "inventory", actor)).length, 0);
    }
  } finally {
    await prisma.amazonSyncRun.update({ where: { id: runA }, data: { finishedAt: original.finishedAt, stage: original.stage } });
  }
});
test("no permission cache crosses two operator credentials", async () => {
  const made = await manageMcpCredential(scope, peer, { action: "create", name: "peer", scopes: [{ sellerAccountId: sellerB, marketplaceIds: [site] }], tools: ["amazon.inventory.list"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const b = await call("amazon.inventory.list", {}, made.token!); assert.ok(JSON.stringify(b).includes(sellerB)); assert.ok(!JSON.stringify(b).includes(sellerA));
  const a = await call("amazon.inventory.list"); assert.ok(!JSON.stringify(a).includes(sellerB));
});
test("real JSON-RPC Route authenticates bearer, rejects origin and hides failures", async () => {
  const request = (authorization: string, origin?: string) => new Request("http://localhost/api/mcp/amazon", { method: "POST", headers: { authorization, "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal((await POST(request(`Bearer ${token}`))).status, 200);
  assert.equal((await POST(request("Bearer invalid"))).status, 401);
  assert.equal((await POST(request(`Bearer ${token}`, "https://evil.invalid"))).status, 403);
});
test("rotation, disable and expiry reject former credentials; audit excludes secrets", async () => {
  const old = await prisma.amazonMcpCredential.findUniqueOrThrow({ where: { id: credentialId } });
  const rotated = await manageMcpCredential(scope, actor, { action: "rotate", id: old.id, revision: old.revision });
  await assert.rejects(() => authenticateAmazonMcp(`Bearer ${token}`));
  token = rotated.token!; credentialId = rotated.credential.id;
  await manageMcpCredential(scope, actor, { action: "disable", id: credentialId, revision: rotated.credential.revision });
  await assert.rejects(() => authenticateAmazonMcp(`Bearer ${token}`));
  await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { status: "ACTIVE", expiresAt: new Date(0) } });
  await assert.rejects(() => authenticateAmazonMcp(`Bearer ${token}`));
  const logs = await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId } });
  assert.ok(logs.some(l => l.action === "amazon.mcp.tool.denied")); assert.ok(!JSON.stringify(logs).includes(token));
});
test("OAuth state is actor-bound, single-use and expires before any external call", async () => {
  Object.assign(process.env, { AMAZON_SP_API_APPLICATION_ID: "fixture", AMAZON_SP_API_LWA_CLIENT_ID: "fixture", AMAZON_SP_API_LWA_CLIENT_SECRET: "fixture", AMAZON_SP_API_OAUTH_REDIRECT_URI: "http://localhost/api/integrations/amazon/sp-api/oauth/callback" });
  const started = await startAmazonOAuth(scope, owner, "us-east-1");
  const state = new URL(started.consentUrl).searchParams.get("state")!;
  await assert.rejects(() => finishAmazonOAuth(actor, new URLSearchParams({ state })), /会话无效/);
  await assert.rejects(() => finishAmazonOAuth(owner, new URLSearchParams({ state, error: "access_denied" })));
  await assert.rejects(() => finishAmazonOAuth(owner, new URLSearchParams({ state })), /会话无效/);
});
test("OAuth happy path uses real client with mocked official HTTP, is idempotent and preserves ERP names", async () => {
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  let sellerId = "OAUTHSELLER123";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.amazon.com/auth/o2/token") {
      const grant = new URLSearchParams(String(init?.body)).get("grant_type");
      return Response.json(grant === "authorization_code" ? { refresh_token: "fixture-refresh-only" } : { access_token: "fixture-access-only", expires_in: 3600 });
    }
    if (url.startsWith("https://sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations")) return Response.json({ payload: [{ marketplace: { id: site, countryCode: "US" }, participation: { isParticipating: true } }] });
    if (url.startsWith(`https://sellingpartnerapi-na.amazon.com/listings/2021-08-01/items/${sellerId}?`)) return Response.json({ items: [] });
    throw new Error("Unexpected external URL blocked");
  };
  async function authorize() { const start = await startAmazonOAuth(scope, owner, "us-east-1"); return finishAmazonOAuth(owner, new URLSearchParams({ state: new URL(start.consentUrl).searchParams.get("state")!, selling_partner_id: sellerId, spapi_oauth_code: "fixture-code" })); }
  const first = await authorize();
  const identity = await prisma.amazonSellerIdentity.findFirstOrThrow({ where: { ...scope, amazonSellerId: sellerId } });
  await prisma.sellerAccount.update({ where: { id: identity.sellerAccountId }, data: { displayName: "User custom name" } });
  const second = await authorize(); assert.equal(first.authorizationId, second.authorizationId);
  assert.equal(await prisma.amazonSellerIdentity.count({ where: { ...scope, amazonSellerId: sellerId } }), 1);
  assert.equal((await prisma.sellerAccount.findUniqueOrThrow({ where: { id: identity.sellerAccountId } })).displayName, "User custom name");
  const old = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: first.authorizationId } });
  assert.ok(old.identityVerifiedAt); assert.ok(!old.credentialsCiphertext.includes("fixture-refresh-only"));
  sellerId = "TAMPEREDSELLER";
  globalThis.fetch = async input => String(input) === "https://api.amazon.com/auth/o2/token" ? Response.json({ refresh_token: "fixture" }) : Response.json({ errors: [{ code: "Unauthorized" }] }, { status: 403 });
  await assert.rejects(authorize);
  assert.equal((await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: first.authorizationId } })).credentialsCiphertext, old.credentialsCiphertext);
  globalThis.fetch = async () => { throw new Error("External HTTP forbidden"); };
});

test("store rename keeps immutable identity, checks CAS and records audit", async () => {
  const before = await prisma.sellerAccount.findUniqueOrThrow({ where: { id: sellerA } });
  const identities = await prisma.amazonSellerIdentity.findMany({ where: { ...scope, sellerAccountId: sellerA } });
  await renameAmazonStore(scope, owner, { id: sellerA, updatedAt: before.updatedAt.toISOString(), displayName: "Renamed ERP store" });
  assert.deepEqual(await prisma.amazonSellerIdentity.findMany({ where: { ...scope, sellerAccountId: sellerA } }), identities);
  await assert.rejects(() => renameAmazonStore(scope, owner, { id: sellerA, updatedAt: before.updatedAt.toISOString(), displayName: "stale" }));
  await assert.rejects(() => listAmazonStores(other, owner));
  assert.equal(await prisma.auditLog.count({ where: { entityId: sellerA, action: "amazon.store.renamed" } }), 1);
});
test("read-only lineage report identifies legacy orphan without guessing SKU ownership", async () => {
  const runId = randomUUID();
  await prisma.amazonSyncRun.create({ data: { ...scope, id: runId, requestedByUserId: owner, resource: "inventory", status: "SUCCEEDED" } });
  await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: randomUUID(), syncRunId: runId, sellerSku: "SAME-SKU", marketplaceId: site, fulfillableQuantity: 777, capturedAt: new Date() } });
  const report = await prisma.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return auditAmazonLineage(tx, scope); });
  assert.equal(report.counts.MISSING_LINEAGE, 1); assert.ok(report.pendingReview.every(r => r.referenceHash.length === 64));
  assert.ok(!JSON.stringify(report).includes("SAME-SKU"));
});
test("lineage audit and historical reads reject mismatched and unfinished runs", async () => {
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA, resource: "inventory" } });
  for (const patch of [{ resource: "catalog" }, { status: "FAILED" }, { finishedAt: null }, { stage: "PURGED" }]) {
    const runId = randomUUID(), rowId = randomUUID();
    await prisma.amazonSyncRun.create({ data: { ...scope, id: runId, sourceId: source.id, requestedByUserId: owner, resource: "inventory", executionVersion: 2, status: "SUCCEEDED", finishedAt: new Date(), ...patch } });
    await prisma.amazonInventorySnapshot.create({ data: { ...scope, id: rowId, sellerAccountId: sellerA, marketplaceId: site, syncRunId: runId, sellerSku: "CORRUPT-LINEAGE", capturedAt: new Date() } });
    try {
      await assert.rejects(() => readTaskSnapshot(scope, new URLSearchParams({ id: runId }), actor));
      const report = await prisma.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`; return auditAmazonLineage(tx, scope); });
      assert.equal(report.counts.UNPUBLISHED_OR_MISMATCHED_RUN, 1);
    } finally {
      await prisma.amazonInventorySnapshot.delete({ where: { id: rowId } });
      await prisma.amazonSyncRun.delete({ where: { id: runId } });
    }
  }
});
test("async export creation scope rejects revoked site at execution/download boundary", async () => {
  process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId]]);
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA, resource: "sales_traffic" } });
  const frozen = { _scopeSourceIds: [source.id], _scopeSellerIds: [sellerA], _scopeAll: false };
  await assertExportJobAccess(prisma, scope, actor, frozen);
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { marketplaceIds: [ca] } });
  await assert.rejects(() => assertExportJobAccess(prisma, scope, actor, frozen));
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { marketplaceIds: [site] } });
});

test("user and role grants complete the sealed request, independent approval and application chain", async () => {
  const approver = randomUUID();
  await prisma.user.create({ data: { id: approver, name: "Approver", email: `${approver}@fixture.invalid`, passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  for (const subject of [{ userId: actor, revision: (await prisma.amazonDataAccessGrant.findUniqueOrThrow({ where: { id: grantId } })).revision }, { roleId: "operations", revision: 0 }]) {
    const change = await requestChange(scope, owner, { action: "save-access-grant", ...subject, sellerAccountId: sellerA, actions: ["view"], marketplaceIds: [site], mcpEnabled: false, enabled: true });
    const id = String(change.id);
    await assert.rejects(() => decideChange(scope, owner, id, "APPROVED", "self approval"));
    await decideChange(scope, approver, id, "APPROVED", "Fixture independent approval");
    await applyChange(scope, owner, id);
    assert.equal((await prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } })).status, "APPLIED");
  }
  assert.equal((await prisma.amazonDataAccessGrant.findUniqueOrThrow({ where: { id: grantId } })).mcpEnabled, false);
});
test("MCP response is withheld when ERP access is revoked while the actual snapshot SQL waits", async () => {
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { mcpEnabled: true, actions: ["view", "export"] } });
  const made = await manageMcpCredential(scope, actor, { action: "create", name: "inflight", scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], tools: ["amazon.inventory.list"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${made.token}`);
  let release = () => {}, acquired = () => {};
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { acquired = r; });
  const lock = prisma.$transaction(async tx => { await tx.$executeRawUnsafe('LOCK TABLE "AmazonInventorySnapshot" IN ACCESS EXCLUSIVE MODE'); acquired(); await gate; }, { timeout: 10000 });
  await ready;
  const pending = invokeAmazonMcp(identity, "amazon.inventory.list", {}).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%AmazonInventorySnapshot%' AND query LIKE 'SELECT%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.ok(waiting, "the real snapshot SQL must reach the held PostgreSQL table lock");
    await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: false } });
  } finally { release(); await lock; }
  const result = await pending; assert.ok(result.error); assert.equal(result.value, null);
  await prisma.amazonDataAccessGrant.update({ where: { id: grantId }, data: { enabled: true } });
});

test("MCP response is withheld when a source binding revision changes during snapshot SQL", async () => {
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA, resource: "inventory" } });
  const fresh = await manageMcpCredential(scope, actor, { action: "create", name: "binding race", scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], tools: ["amazon.inventory.list"], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${fresh.token}`);
  let release = () => {}, acquired = () => {};
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { acquired = r; });
  const lock = prisma.$transaction(async tx => { await tx.$executeRawUnsafe('LOCK TABLE "AmazonInventorySnapshot" IN ACCESS EXCLUSIVE MODE'); acquired(); await gate; }, { timeout: 10000 });
  await ready;
  const pending = invokeAmazonMcp(identity, "amazon.inventory.list", {}).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%AmazonInventorySnapshot%' AND query LIKE 'SELECT%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.ok(waiting, "snapshot SQL should wait on the disposable fixture lock");
    await prisma.amazonSyncDataSource.update({ where: { id: source.id }, data: { revision: { increment: 1 } } });
  } finally { release(); await lock; }
  const result = await pending; assert.ok(result.error); assert.equal(result.value, null);
});

test("source preview refuses mixed authorization domains and another seller's verified identity", async () => {
  const a = await prisma.amazonSellerIdentity.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerA } });
  const b = await prisma.amazonSellerIdentity.findFirstOrThrow({ where: { ...scope, sellerAccountId: sellerB } });
  await assert.rejects(() => requestChange(scope, owner, { action: "save-source", authorizationId: b.authorizationId, sellerAccountId: sellerA, marketplaceId: site, resource: "catalog", enabled: true }), /绑定冲突/);
  const freshSeller = randomUUID(); await prisma.sellerAccount.create({ data: { ...scope, id: freshSeller, accountKey: freshSeller, displayName: "Unrelated ERP", marketplaceCode: "US" } });
  await assert.rejects(() => requestChange(scope, owner, { action: "save-source", authorizationId: a.authorizationId, sellerAccountId: freshSeller, marketplaceId: site, resource: "catalog", enabled: true }), /绑定冲突/);
});

test("bounded management routes preserve real session identity and workspace checks", async () => {
  async function request(userId: string, path: string, method: string, body: object) {
    const session = await createSession(userId);
    return new Request(`http://localhost${path}`, { method, headers: { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "x-workspace-id": scope.workspaceId, "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
  }
  const issued = await credentialPost(await request(actor, "/api/operations/amazon-mcp", "POST", { action: "create", name: "Bounded route", tools: ["amazon.inventory.list"], scopes: [{ sellerAccountId: sellerA, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 60000).toISOString() }));
  assert.equal(issued.status, 200);
  const payload = await issued.json();
  const credential = await prisma.amazonMcpCredential.findUniqueOrThrow({ where: { id: payload.credential.id } });
  assert.equal(credential.userId, actor); assert.equal(credential.workspaceId, scope.workspaceId);
  const store = await prisma.sellerAccount.findUniqueOrThrow({ where: { id: sellerA } });
  const body = { id: sellerA, updatedAt: store.updatedAt.toISOString(), displayName: "Route validated rename" };
  assert.equal((await storePatch(await request(actor, "/api/operations/amazon-stores", "PATCH", body))).status, 403);
  assert.equal((await storePatch(await request(owner, "/api/operations/amazon-stores", "PATCH", body))).status, 200);
  const start = await oauthStart(await request(owner, "/api/integrations/amazon/sp-api/oauth/start", "POST", { region: "us-east-1" }));
  assert.equal(start.status, 200); assert.equal(new URL((await start.json()).consentUrl).hostname, "sellercentral.amazon.com");
});
