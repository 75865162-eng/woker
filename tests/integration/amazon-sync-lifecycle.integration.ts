import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { endpoints } from "@/lib/amazon-sync/policy";
import { tickSyncCenter } from "@/lib/amazon-sync/scheduler";
import { scopeLock, syncIncrementalCursorStatus } from "@/lib/amazon-sync/service";
import { listSources, readTasks } from "@/lib/amazon-sync/read";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import type { AmazonSyncResourceCursor } from "@prisma/client";
import { automaticPlanId } from "@/lib/amazon-sync/automatic-schedule";
if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline database required");
const raw = (resource: string, name: string) => readFileSync(new URL(`../fixtures/amazon/${resource}/${name}`, import.meta.url), "utf8");
const scopes: Array<[string, string]> = [], region = "lifecycle-fixture-region";
before(() => { process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 71).toString("base64"); endpoints[region] = "https://lifecycle.fixture.invalid"; process.env.QUEUE_DRIVER = "redis"; });
after(async () => { delete endpoints[region]; await getAmazonSyncQueue().close(); await prisma.$disconnect(); });
const evidence = (c: AmazonSyncResourceCursor) => JSON.stringify({ from: c.watermarkFrom, to: c.watermarkTo, next: c.nextTokenCiphertext, report: c.reportStateCiphertext, listComplete: c.listComplete, captureSequence: c.captureSequence, lastSuccessAt: c.lastSuccessAt });
async function fresh(resource: "orders" | "finance" | "returns") {
  const scope = { organizationId: `lifecycle-fixture-${randomUUID()}`, workspaceId: "lifecycle-test" };
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  const actor = randomUUID(), approver = randomUUID(), store = randomUUID(), authId = randomUUID();
  const policy = { ...JSON.parse(raw(resource, "policy.json")), applicationId: `fixture-${authId}` };
  const site = resource === "finance" ? policy.marketplaces[0].marketplaceId : "fixture-marketplace";
  const roles = resource === "orders" ? policy.requiredRoles : [resource === "finance" ? "Finance and Accounting" : "Amazon Fulfillment"];
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Lifecycle fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Lifecycle fixture" } });
  for (const id of [actor, approver]) await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: store, accountKey: store, displayName: "Lifecycle fixture", marketplaceCode: "FX" } });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authId, name: "Lifecycle fixture", amazonSellerId: "fixture-seller", awsRegion: region, endpoint: endpoints[region], status: "CONFIGURED", approvedRoles: roles, rolesAttestedAt: new Date(), marketplaceParticipations: (resource === "finance" ? policy.marketplaces : [{ marketplaceId: site }]).map((m: { marketplaceId: string }) => ({ marketplaceId: m.marketplaceId, countryCode: "FX" })), updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId: authId }) } });
  async function approved(command: Record<string, unknown>) {
    const request = await requestChange(scope, actor, command), id = String(request.id);
    await decideChange(scope, approver, id, "APPROVED", "offline lifecycle fixture"); await applyChange(scope, actor, id);
    return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id } });
  }
  if (resource === "finance") for (const m of policy.marketplaces) await approved({ action: "save-source", authorizationId: authId, sellerAccountId: store, marketplaceId: m.marketplaceId, resource: "catalog", freshnessMinutes: 60, enabled: true });
  const change = await approved({ action: "save-source", authorizationId: authId, sellerAccountId: store, marketplaceId: site, resource, freshnessMinutes: 60, enabled: true, [resource === "orders" ? "orderPolicy" : resource === "finance" ? "financePolicy" : "returnsPolicy"]: policy });
  const source = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: change.targetId } });
  const grant = await approved({ action: "run", sourceIds: [source.id] });
  const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: grant.id } });
  const calls: URL[] = [];
  const transport = async (input: string | URL) => {
    const url = new URL(String(input)); calls.push(url); assert.ok(["lwa.fixture.invalid", "lifecycle.fixture.invalid"].includes(url.hostname));
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    if (resource === "returns") return Response.json(url.pathname.endsWith("/fixture-report") ? { reportId: "fixture-report", reportType: policy.reportType, marketplaceIds: [site], dataStartTime: policy.initialFrom, dataEndTime: "2026-11-02T00:00:00Z", processingStatus: "IN_PROGRESS" } : { reportId: "fixture-report" });
    return new Response(raw(resource, url.searchParams.has(resource === "orders" ? "paginationToken" : "nextToken") ? "page-2.json" : "page-1.json"));
  };
  async function current() { return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } }); }
  async function cursor() { return prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } }); }
  async function slice(version?: number, fetcher = transport) {
    await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date(0) } });
    await processSyncCenterTask(run.id, version ?? (await current()).dispatchVersion, { clientOptions: { fetch: fetcher, tokenEndpoint: "https://lwa.fixture.invalid/token" } });
    return current();
  }
  await slice(); calls.length = 0;
  return { scope, actor, approver, source, run, grant, calls, approved, current, cursor, slice };
}
for (const resource of ["orders", "finance", "returns"] as const) {
  test(`${resource}: pause/resume/cancel synchronize cursor and preserve encrypted progress`, async () => {
    const f = await fresh(resource), saved = evidence(await f.cursor()), old = (await f.current()).dispatchVersion;
    await f.approved({ action: "control-task", id: f.run.id, control: "pause" });
    assert.equal((await f.current()).status, "PAUSED"); assert.equal((await f.cursor()).status, "PAUSED");
    await f.slice(old); assert.equal(f.calls.length, 0);
    await f.approved({ action: "control-task", id: f.run.id, control: "resume" });
    assert.equal((await f.current()).status, "WAITING"); assert.equal((await f.cursor()).status, "WAITING");
    await f.approved({ action: "control-task", id: f.run.id, control: "cancel" });
    assert.equal((await f.current()).status, "CANCELLED"); assert.equal((await f.cursor()).status, "CANCELLED");
    assert.equal(evidence(await f.cursor()), saved); assert.equal(f.calls.length, 0);
  });
  for (const exhausted of [false, true]) test(`${resource}: lease expiry ${exhausted ? "stops" : "recovers"} with cursor and generation fence`, async () => {
    const f = await fresh(resource), saved = evidence(await f.cursor()), old = await f.current();
    await prisma.amazonSyncRun.update({ where: { id: f.run.id }, data: { status: "RUNNING", leaseOwner: "fixture-old-worker", leaseExpiresAt: new Date(0), attempts: exhausted ? old.maxAttempts : 1 } });
    await tickSyncCenter(new Date(), { taskIds: [f.run.id], exportIds: [] });
    const r = await f.current(); assert.equal(r.status, exhausted ? "FAILED" : "RETRY_WAIT");
    assert.equal((await f.cursor()).status, r.status); assert.ok(r.fenceVersion > old.fenceVersion);
    assert.equal(evidence(await f.cursor()), saved); await f.slice(old.dispatchVersion); assert.equal(f.calls.length, 0);
    if (!exhausted) {
      const job = await getAmazonSyncQueue().getJob(`adc-${r.id}-${r.dispatchVersion}`); assert.ok(job);
      const resumed = await f.slice(); assert.equal(resumed.status, resource === "returns" ? "WAITING" : "SUCCEEDED");
      const call = f.calls.find(u => u.hostname === "lifecycle.fixture.invalid")!;
      if (resource === "returns") assert.ok(call.pathname.endsWith("/fixture-report"));
      else assert.equal(call.searchParams.get(resource === "orders" ? "paginationToken" : "nextToken"), resource === "orders" ? "fixture-next-page-2" : "fixture-page-2");
    }
    else {
      await f.approved({ action: "control-task", id: f.run.id, control: "retry" });
      assert.equal((await f.current()).status, "WAITING"); assert.equal((await f.cursor()).status, "WAITING"); assert.equal(evidence(await f.cursor()), saved);
    }
  });
  for (const fault of ["deadline", "approval", "preflight"] as const) test(`${resource}: ${fault} blocks without HTTP or loss of cursor`, async () => {
    const f = await fresh(resource), saved = evidence(await f.cursor());
    if (fault === "deadline") {
      const frozen = { ...(f.run.frozenScope as object), executionExpiresAt: new Date(0).toISOString() };
      await prisma.amazonSyncRun.update({ where: { id: f.run.id }, data: { frozenScope: frozen, frozenScopeDigest: digest(frozen), nextAttemptAt: new Date(0) } });
    } else if (fault === "approval") await prisma.amazonDataCenterChangeRequest.update({ where: { id: f.grant.id }, data: { status: "REVOKED" } });
    else await prisma.amazonSpApiAuthorization.update({ where: { id: f.source.authorizationId }, data: { amazonSellerId: "fixture-replaced-seller" } });
    if (fault === "preflight") await f.slice();
    else { await prisma.amazonSyncRun.update({ where: { id: f.run.id }, data: { nextAttemptAt: new Date(0) } }); await tickSyncCenter(new Date(), { taskIds: [f.run.id], exportIds: [] }); }
    assert.equal((await f.current()).status, "BLOCKED"); assert.equal((await f.cursor()).status, "BLOCKED");
    assert.equal(evidence(await f.cursor()), saved); assert.equal(f.calls.length, 0);
    const view = (await listSources(f.scope, { resource }, f.actor))[0];
    assert.equal(view.resourceCursor?.status, "BLOCKED"); assert.equal(view.resourceCursor?.hasIncompleteWindow, true);
    const tasks = await readTasks(f.scope, new URLSearchParams({ sourceId: f.source.id }), f.actor);
    assert.match(tasks.rows[0].operatorAction!, /审批/);
    const json = JSON.stringify({ cursor: view.resourceCursor, tasks });
    for (const value of ["Ciphertext", "fixture-access", "fixture-secret", "fixture-next-page", "fixture-page-2", "reportState", "leaseOwner"]) assert.ok(!json.includes(value));
  });
  test(`${resource}: status synchronization cannot overwrite completed or another run's cursor`, async () => {
    const f = await fresh(resource);
    await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status: "SUCCEEDED", lastSuccessAt: new Date() } });
    const saved = evidence(await f.cursor());
    await prisma.$transaction(async tx => { await scopeLock(tx, f.scope); await syncIncrementalCursorStatus(tx, await f.current(), "FAILED"); });
    assert.equal((await f.cursor()).status, "SUCCEEDED"); assert.equal(evidence(await f.cursor()), saved);
    await prisma.amazonSyncResourceCursor.update({ where: { sourceId: f.source.id }, data: { status: "RUNNING" } });
    await prisma.$transaction(async tx => { await scopeLock(tx, f.scope); await syncIncrementalCursorStatus(tx, { ...await f.current(), id: "fixture-stale-run" }, "BLOCKED"); });
    assert.equal((await f.cursor()).status, "RUNNING"); assert.equal(evidence(await f.cursor()), saved);
  });
}

for (const resource of ["orders", "finance", "returns"] as const) test(`${resource}: pause requested during HTTP takes effect before committing progress`, async () => {
  const f = await fresh(resource), saved = evidence(await f.cursor());
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const work = f.slice(undefined, async input => {
    const url = new URL(String(input)); assert.ok(["lwa.fixture.invalid", "lifecycle.fixture.invalid"].includes(url.hostname));
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    enter(); await gate;
    if (resource === "returns") return Response.json({ reportId: "fixture-report", reportType: JSON.parse(raw(resource, "policy.json")).reportType, marketplaceIds: ["fixture-marketplace"], dataStartTime: "2026-11-01T00:00:00Z", dataEndTime: "2026-11-02T00:00:00Z", processingStatus: "IN_PROGRESS" });
    return new Response(raw(resource, "page-2.json"));
  });
  await entered;
  try { await f.approved({ action: "control-task", id: f.run.id, control: "pause" }); assert.equal((await f.current()).control, "PAUSE"); }
  finally { release(); }
  assert.equal((await work).status, "PAUSED"); assert.equal((await f.cursor()).status, "PAUSED");
  assert.equal(evidence(await f.cursor()), saved);
});

for (const resource of ["orders", "finance", "returns"] as const) test(`${resource}: malformed response records the resource validation code`, async () => {
  const f = await fresh(resource);
  const result = await f.slice(undefined, async input => {
    const url = new URL(String(input)); assert.ok(["lwa.fixture.invalid", "lifecycle.fixture.invalid"].includes(url.hostname));
    return Response.json(url.hostname === "lwa.fixture.invalid" ? { access_token: "fixture-access", expires_in: 3600 } : {});
  });
  assert.equal(result.status, "FAILED"); assert.equal((await f.cursor()).status, "FAILED");
  const log = await prisma.amazonSyncTaskLog.findFirstOrThrow({ where: { taskId: f.run.id, event: "FAILED" }, orderBy: { createdAt: "desc" } });
  assert.equal(log.code, `${resource === "returns" ? "RETURN" : resource === "finance" ? "FINANCE" : "ORDER"}_VALIDATION`);
});

test("lease recovery rolls back run transition when cursor update fails", async () => {
  const f = await fresh("finance"), saved = evidence(await f.cursor());
  const before = await prisma.amazonSyncRun.update({ where: { id: f.run.id }, data: { status: "RUNNING", leaseOwner: "fixture-interrupted", leaseExpiresAt: new Date(0), attempts: 1 } });
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_reject_lifecycle_cursor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture lifecycle rollback'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_reject_lifecycle_cursor BEFORE UPDATE ON "AmazonSyncResourceCursor" FOR EACH ROW EXECUTE FUNCTION fixture_reject_lifecycle_cursor()`);
  try { await assert.rejects(tickSyncCenter(new Date(), { taskIds: [f.run.id], exportIds: [] })); }
  finally { await prisma.$executeRawUnsafe('DROP TRIGGER fixture_reject_lifecycle_cursor ON "AmazonSyncResourceCursor"'); await prisma.$executeRawUnsafe('DROP FUNCTION fixture_reject_lifecycle_cursor()'); }
  const after = await f.current();
  assert.equal(after.status, "RUNNING"); assert.equal(after.dispatchVersion, before.dispatchVersion); assert.equal(after.fenceVersion, before.fenceVersion); assert.equal(after.leaseOwner, before.leaseOwner);
  assert.equal((await f.cursor()).status, "RUNNING"); assert.equal(evidence(await f.cursor()), saved);
  assert.equal(await prisma.amazonSyncTaskLog.count({ where: { taskId: f.run.id, event: "LEASE_EXPIRED" } }), 0); assert.equal(f.calls.length, 0);
});

test("validated Seller ID must not gate bounded 730-day tasks for existing US/CA bindings", async () => {
  const scope = { organizationId: `automatic-fixture-${randomUUID()}`, workspaceId: "automatic-test" };
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  const actor = randomUUID(), store = randomUUID(), authId = randomUUID();
  const sites = ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2"];
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Automatic fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Automatic fixture" } });
  await prisma.user.create({ data: { id: actor, email: `${actor}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: store, accountKey: store, marketplaceCode: "US", status: "inactive" } });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authId, name: "Automatic fixture", amazonSellerId: "automatic-fixture-seller", awsRegion: region, endpoint: endpoints[region], status: "NOT_CONFIGURED", approvedRoles: ["Fixture Order Read", "Finance and Accounting", "Amazon Fulfillment", "Pricing", "Product Listing"], rolesAttestedAt: new Date(), marketplaceParticipations: sites.map(marketplaceId => ({ marketplaceId, countryCode: "US" })), updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-auto-client", lwaClientSecret: "fixture-auto-secret", refreshToken: "fixture-auto-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId: authId }) } });
  const sources = [];
  for (const site of sites) for (const resource of ["inventory", "catalog", "orders", "sales_traffic"]) {
    sources.push(await prisma.amazonSyncDataSource.create({ data: { ...scope, id: randomUUID(), authorizationId: authId, sellerAccountId: store, marketplaceId: site, resource, freshnessMinutes: 2880, enabled: false, ...(resource === "orders" ? { orderPolicy: { ...JSON.parse(raw("orders", "policy.json")), applicationId: `fixture-auto-${authId}`, marketplaceTimeZone: "America/Los_Angeles" } } : {}) } }));
  }
  sources.push(await prisma.amazonSyncDataSource.create({ data: { ...scope, id: randomUUID(), authorizationId: authId, sellerAccountId: store, marketplaceId: sites[0], resource: "finance", freshnessMinutes: 2880, enabled: false, financePolicy: { ...JSON.parse(raw("finance", "policy.json")), applicationId: `fixture-auto-${authId}`, marketplaces: sites.map(marketplaceId => ({ marketplaceId, marketplaceTimeZone: "America/Los_Angeles" })), fx: null } } }));
  const appId = `fixture-auto-${authId}`;
  for (const resource of ["returns", "settlements", "reimbursements", "inventory_age", "inventory_events", "fulfillment", "listing_details", "catalog_items", "pricing"] as const) {
    const data = resource === "returns" ? { returnsPolicy: { ...JSON.parse(raw("returns", "policy.json")), applicationId: appId, marketplaceTimeZone: "America/Los_Angeles" } }
      : ["fulfillment", "listing_details", "catalog_items", "pricing"].includes(resource) ? { domainPolicy: { resource, applicationId: appId, maxRequests: 30, maxRows: 1000, requestsPerSecond: resource === "pricing" ? .01 : resource === "fulfillment" ? .1 : .5, ...(resource === "fulfillment" ? { planIds: ["A".repeat(38)] } : resource === "listing_details" ? { sellerSkus: ["fixture-sku"] } : { asins: ["B123456789"] }) } } : {};
    sources.push(await prisma.amazonSyncDataSource.create({ data: { ...scope, id: randomUUID(), authorizationId: authId, sellerAccountId: store, marketplaceId: sites[0], resource, freshnessMinutes: 2880, enabled: false, ...data } }));
  }
  await tickSyncCenter();
  assert.equal(await prisma.amazonSyncSchedule.count({ where: scope }), 0);
  await prisma.amazonSpApiAuthorization.update({ where: { id: authId }, data: { status: "CONFIGURED" } });
  const now = new Date();
  await tickSyncCenter(now, { taskIds: [], exportIds: [] });
  assert.equal(await prisma.amazonSyncSchedule.count({ where: scope }), 0, "approved-only mode cannot create future tasks");
  await tickSyncCenter(now);
  assert.equal(await prisma.amazonSyncSchedule.count({ where: scope }), 18);
  assert.equal(await prisma.amazonSyncRun.count({ where: scope }), 18);
  await tickSyncCenter(now);
  assert.equal(await prisma.amazonSyncRun.count({ where: scope }), 18, "duplicate ticks cannot create duplicate tasks");
  for (const source of sources) {
    const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, sourceId: source.id } });
    assert.equal(run.scheduleId, automaticPlanId(source.id)); assert.equal(run.trigger, "schedule"); assert.equal(run.executionApprovalId, null);
    const frozen = run.frozenScope as { requestedRange?: { from: string; to: string }; orderWindow?: { from: string; to: string }; financeWindow?: { from: string; to: string } };
    const window = frozen.orderWindow ?? frozen.financeWindow;
    if (window) {
      assert.equal(Date.parse(window.from), now.getTime() - 730 * 86400_000);
      assert.ok(Date.parse(window.to) - Date.parse(window.from) <= (source.resource === "orders" ? 1 : 30) * 86400_000);
    }
    if (frozen.requestedRange) assert.equal(Date.parse(frozen.requestedRange.to) - Date.parse(frozen.requestedRange.from), 30 * 86400_000);
    if (source.resource === "returns") { assert.equal(Date.parse((frozen as { returnWindow: { from: string } }).returnWindow.from), now.getTime() - 730 * 86400_000); assert.ok(Date.parse((frozen as { returnWindow: { to: string } }).returnWindow.to) - Date.parse((frozen as { returnWindow: { from: string } }).returnWindow.from) <= 30 * 86400_000); }
    if (source.resource === "inventory_events") { const w = (frozen as { reportWindow: { from: string; to: string } }).reportWindow; assert.ok(Date.parse(w.to) - Date.parse(w.from) <= 30 * 86400_000); assert.equal((frozen as { endpoint?: string }).endpoint, endpoints[region]); }
    if (source.resource === "settlements") { const w = (frozen as { reportWindow: { createdSince: string; createdUntil: string } }).reportWindow; assert.ok(Date.parse(w.createdUntil) - Date.parse(w.createdSince) <= 90 * 86400_000); }
  }
  const orders = sources.find(s => s.resource === "orders")!;
  const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, sourceId: orders.id } });
  let calls = 0;
  await processSyncCenterTask(run.id, run.dispatchVersion, { clientOptions: { tokenEndpoint: "https://lwa.fixture.invalid/token", fetch: async input => { calls++; const url = new URL(String(input)); return Response.json(url.hostname === "lwa.fixture.invalid" ? { access_token: "fixture-auto-token", expires_in: 3600 } : { orders: [] }); } } });
  assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } })).status, "SUCCEEDED"); assert.ok(calls > 0);
  await tickSyncCenter(new Date(now.getTime() + 120_000));
  assert.equal(await prisma.amazonSyncRun.count({ where: { ...scope, sourceId: orders.id } }), 2, "next bounded window advances automatically");
  const next = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, sourceId: orders.id, id: { not: run.id } } });
  await prisma.amazonSyncSchedule.update({ where: { id: automaticPlanId(orders.id) }, data: { enabled: false } });
  calls = 0;
  await processSyncCenterTask(next.id, next.dispatchVersion, { clientOptions: { fetch: async () => { calls++; throw new Error("must not send after pause"); } } });
  assert.equal(calls, 0); assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: next.id } })).status, "BLOCKED");
  await tickSyncCenter(new Date(now.getTime() + 240_000));
  assert.equal((await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: automaticPlanId(orders.id) } })).enabled, false);
  for (const resource of ["returns", "finance"]) {
  const returns: { id: string } = sources.find(s => s.resource === resource)!;
  const returnsPlan = await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: automaticPlanId(returns.id) } });
  async function setAutomaticPlanEnabled(enabled: boolean, revision: number) {
    const request = await requestChange(scope, actor, { action: "save-plan", id: returnsPlan.id, revision, name: returnsPlan.name, resource: returnsPlan.resource, enabled, sourceIds: [returns.id], intervalMinutes: returnsPlan.intervalMinutes, priority: returnsPlan.priority, maxAttempts: returnsPlan.maxAttempts, retentionDays: returnsPlan.retentionDays });
    const requestId = String(request.id);
    await decideChange(scope, actor, requestId, "APPROVED", "offline lifecycle fixture");
    await applyChange(scope, actor, requestId);
  }
  await setAutomaticPlanEnabled(false, returnsPlan.revision);
  const paused = await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: returnsPlan.id } });
  await setAutomaticPlanEnabled(true, paused.revision);
  assert.equal((await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: returnsPlan.id } })).enabled, true);
  }
});

test("a validated token without Seller ID auto-binds four North American sites and publishes current listings", async () => {
  const scope = { organizationId: `token-account-${randomUUID()}`, workspaceId: "token-account-test" };
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  const actor = randomUUID(), authId = randomUUID();
  const sites = ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8", "A2Q3Y263D00KWC"];
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Token account fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Token account fixture" } });
  await prisma.user.create({ data: { id: actor, email: `${actor}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.amazonSpApiAuthorization.create({ data: {
    ...scope, id: authId, name: "North America token", amazonSellerId: "", awsRegion: "us-east-1", endpoint: endpoints["us-east-1"], status: "CONFIGURED",
    credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-token-client", lwaClientSecret: "fixture-token-secret", refreshToken: "fixture-token-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId: authId }),
    marketplaceParticipations: sites.map(marketplaceId => ({ marketplaceId, countryCode: "US" })), lastValidatedAt: new Date(), updatedByUserId: actor,
  } });

  const now = new Date(Date.now() - 60_000);
  await tickSyncCenter(now);
  const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: authId } });
  assert.equal(sources.length, 37);
  assert.deepEqual([...new Set(sources.map(source => source.marketplaceId))].sort(), [...sites].sort());
  assert.equal(new Set(sources.map(source => source.sellerAccountId)).size, 1);
  const catalog = sources.find(source => source.resource === "catalog" && source.marketplaceId === sites[0])!;
  const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, sourceId: catalog.id } });
  assert.equal((run.frozenScope as { requestedRange?: unknown }).requestedRange, undefined, "a current Listing snapshot must not claim historical coverage");

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.amazon.com") return Response.json({ access_token: "fixture-token", expires_in: 3600 });
    if (url.hostname === "sellingpartnerapi-na.amazon.com" && url.pathname === "/reports/2021-06-30/reports" && init?.method === "POST") {
      assert.deepEqual(JSON.parse(String(init.body)), { reportType: "GET_MERCHANT_LISTINGS_ALL_DATA", marketplaceIds: [sites[0]], reportOptions: { preferredReportDocumentLocale: "en_US" } });
      return Response.json({ reportId: "fixture-listings-report" });
    }
    if (url.hostname === "sellingpartnerapi-na.amazon.com" && url.pathname === "/reports/2021-06-30/reports/fixture-listings-report") return Response.json({ reportId: "fixture-listings-report", reportType: "GET_MERCHANT_LISTINGS_ALL_DATA", marketplaceIds: [sites[0]], processingStatus: "DONE", reportDocumentId: "fixture-listings-document" });
    if (url.hostname === "sellingpartnerapi-na.amazon.com" && url.pathname === "/reports/2021-06-30/documents/fixture-listings-document") return Response.json({ reportDocumentId: "fixture-listings-document", url: "https://s3.amazonaws.com/fixture/report" });
    if (url.hostname === "s3.amazonaws.com") return new Response("seller-sku\tasin1\tstatus\tfulfillment-channel\nSKU-1\tB012345678\tActive\tAMAZON_NA\n", { headers: { "content-type": "text/plain" } });
    throw new Error(`Unexpected fixture URL ${url.hostname}${url.pathname}`);
  };
  for (let i = 0; i < 5; i++) {
    const current = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
    if (current.status === "SUCCEEDED") break;
    await prisma.amazonSyncRun.update({ where: { id: current.id }, data: { nextAttemptAt: new Date(0) } });
    await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: authId }, data: { nextRequestAt: new Date(0) } });
    await processSyncCenterTask(current.id, current.dispatchVersion, { clientOptions: { fetch } });
  }
  const completed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(await prisma.amazonCatalogSnapshot.count({ where: { ...scope, sourceRunId: run.id, sellerSku: "SKU-1", asin: "B012345678" } }), 1);
  const published = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: catalog.id } });
  assert.equal(published.activeRunId, run.id); assert.equal(published.rowCount, 1);
  const coverage = published.coverage as { historicalSnapshot?: boolean; reportType?: string };
  assert.equal(coverage.reportType, "GET_MERCHANT_LISTINGS_ALL_DATA"); assert.equal(coverage.historicalSnapshot, false);
});
