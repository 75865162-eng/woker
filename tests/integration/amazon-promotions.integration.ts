import { registerPromotionsHttpAcceptance } from "./amazon-promotions-http.acceptance";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { ensureAmazonSyncInitialized } from "@/lib/amazon-sync/scheduler";
// Cloud role for injected offline task fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import { unseal, digest } from "@/lib/amazon-sync/approval-policy";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { readObservations } from "@/lib/amazon-sync/observations-query";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { endpoints } from "@/lib/amazon-sync/policy";
import { manageMcpCredential, authenticateAmazonMcp, invokeAmazonMcp } from "@/lib/amazon-sync/mcp";
import { createErpResearchTransport } from "@/lib/lili/runtime-server";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline DB required");
const site = "ATVPDKIKX0DER", region = "observation-fixture", scopes: Array<[string, string]> = [];
before(() => { endpoints[region] = "https://observations.fixture.invalid"; process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 63).toString("base64"); });
after(async () => { delete endpoints[region]; await getAmazonSyncQueue().close(); await prisma.$disconnect(); });
export async function fresh(resource: string, extra: Record<string, unknown> = {}, processWorker = false, marketplace = site) {
  const site = marketplace;
  const authRegion = processWorker ? "us-east-1" : region;
  const scope = { organizationId: `observation-${randomUUID()}`, workspaceId: "fixture" }, actor = randomUUID(), approver = randomUUID(), authorizationId = randomUUID(), sellerAccountId = randomUUID();
  scopes.push([scope.organizationId, scope.workspaceId]); process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify(scopes);
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Fixture" } });
  for (const id of [actor, approver]) await prisma.user.create({ data: { id, email: `${id}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: sellerAccountId, accountKey: sellerAccountId, displayName: "Fixture", marketplaceCode: "US" } });
  await prisma.amazonDataAccessGrant.createMany({ data: [actor, approver].map(userId => ({ ...scope, id: randomUUID(), userId, sellerAccountId, marketplaceIds: [site], actions: ["view", "sync"] })) });
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: authorizationId, name: "Fixture", amazonSellerId: "fixture-seller", awsRegion: authRegion, endpoint: endpoints[authRegion], status: "CONFIGURED", identityVerifiedAt: new Date(), approvedRoles: ["Amazon Fulfillment", "Pricing", "Brand Analytics", "Selling Partner Insights", "Product Listing"], rolesAttestedAt: new Date(), marketplaceParticipations: [{ marketplaceId: site, countryCode: "US" }], updatedByUserId: actor, credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture", lwaClientSecret: "fixture", refreshToken: "fixture", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...scope, authorizationId }) } });
  const domainPolicy = { resource, applicationId: "fixture-app", maxRequests: 30, maxRows: 1000, requestsPerSecond: .1, ...extra };
  async function approved(body: Record<string, unknown>) { const r = await requestChange(scope, actor, body); await decideChange(scope, approver, String(r.id), "APPROVED", "fixture"); await applyChange(scope, actor, String(r.id)); return prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({ where: { id: String(r.id) } }); }
  const config = await approved({ action: "save-source", authorizationId, sellerAccountId, marketplaceId: site, resource, domainPolicy, enabled: true, freshnessMinutes: 1440 });
  const sourceId = config.targetId;
  let mode = "normal"; const calls: string[] = [];
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input)); assert.ok(["observations.fixture.invalid", "lwa.fixture.invalid", "download.fixture.invalid"].includes(url.hostname)); calls.push(url.pathname);
    if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture", expires_in: 3600 });
    if (url.pathname.startsWith("/promotions/2025-12-01/promotions")) {
      assert.equal(init?.method, "GET");
      const detail = { promotionId: "promo-one", marketplaceId: site, promotionType: "COUPON", status: ["expired", "old-expired"].includes(mode) ? "EXPIRED" : "RUNNING", promotionTitle: "Fixture promotion", trackingId: "track-one", createdDate: "2026-09-01T00:00:00Z", lastUpdatedDate: "2026-10-10T00:00:00Z", schedule: { startDate: "2026-10-01T00:00:00Z", endDate: mode === "old-expired" ? "2026-09-01T00:00:00Z" : "2026-11-30T00:00:00Z" }, selection: { type: "ITEMS", selectionId: "selection-one", revisionId: 1 }, feeSnapshot: { previewedFeeRates: { upfrontFee: { rate: { amount: 100, currencyCode: "USD" }, frequency: "ONE_TIME" } } }, unknownBusiness: { retained: null } };
      if (url.pathname.endsWith("/selections/selection-one")) {
        assert.equal(url.searchParams.get("revisionId"), "1"); assert.equal(url.searchParams.get("includedData"), "ISSUES");
        return new Response('{"selection":{"type":"ITEMS","selectionId":"selection-one","revisionId":1,"selectionDetails":{"items":' + (url.searchParams.has("paginationToken") ? (mode === "http-pagination" ? '[{"asin":"B987654321","sku":"fixture-sku-page2"}]' : '[]') : '[{"asin":"B123456789","sku":"fixture-sku","budget":{"type":"AMOUNT","value":123456789.123456789,"currencyCode":"USD"}}]') + ',"issues":[],"pagination":' + (url.searchParams.has("paginationToken") ? '{}' : '{"nextToken":"next-selection"}') + '}}}');
      }
      if (url.pathname.endsWith("/promo-one")) return Response.json(mode === "bad-detail" ? { ...detail, marketplaceId: "FOREIGN" } : mode === "summary-drift" ? { ...detail, status: "EXPIRED" } : mode === "stale-detail" ? { ...detail, lastUpdatedDate: "2026-09-10T00:00:00Z" } : detail);
      assert.equal(url.searchParams.get("revision"), "ANY"); assert.equal(url.searchParams.get("marketplaceIds"), site);
      return Response.json({ totalResults: mode === "no-longer-returned" ? 0 : mode === "gap" ? 2 : 1, promotions: mode === "no-longer-returned" ? [] : url.searchParams.has("paginationToken") ? [detail] : [], ...(url.searchParams.has("paginationToken") ? {} : { pagination: { nextToken: "next-search" } }) });
    }
    throw new Error("Unexpected mock request");
  };
  async function start() { const request = await approved({ action: "run", sourceIds: [sourceId] }); return prisma.amazonSyncRun.findFirstOrThrow({ where: { executionApprovalId: request.id } }); }
  async function slice(id: string) {
    await prisma.amazonSyncRun.update({ where: { id }, data: { nextAttemptAt: new Date(0) } });
    await prisma.amazonSyncApiBudget.updateMany({ where: scope, data: { nextRequestAt: new Date(0) } });
    // Isolated fixture only: advance quota time rather than sleeping.
    await prisma.amazonSyncTokenBucket.updateMany({ data: { tokens: 1, replenishedAt: new Date(0), blockedUntil: null } });
    const run = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
    await processSyncCenterTask(id, run.dispatchVersion, { clientOptions: { fetch: fetcher, tokenEndpoint: "https://lwa.fixture.invalid/token", reportDownloadTestHost: "download.fixture.invalid" } });
    return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id } });
  }
  async function finish(id: string) { for (let i = 0; i < 260; i++) { const run = await slice(id); if (!["WAITING", "QUEUED", "RETRY_WAIT"].includes(run.status)) return run; } throw new Error("Fixture exceeded bounded slices"); }
  const read = (params: Record<string, string> = {}) => readObservations(scope, new URLSearchParams({ resource, sourceId, sellerAccountId, marketplaceId: site, ...params }), actor);
  return { scope, actor, approver, authorizationId, sellerAccountId, sourceId, start, slice, finish, read, approved, calls, setMode: (v: string) => { mode = v; } };
}


test("promotions: empty discovery page, all item pages, archive, exact decimals, publication and local MCP/Lili", async () => {
  const f = await fresh("promotions"), run = await f.start();
  await f.slice(run.id); assert.equal((await f.read()).rows.length, 0);
  const done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", done.error ?? "");
  const result = await f.read(); assert.equal(result.pagination.total, 5);
  assert.equal((await f.read({ kind: "PROMOTION_SUMMARY", from: "2026-10-01", to: "2026-10-31" })).pagination.total, 1);
  assert.equal((await f.read({ kind: "PROMOTION_SUMMARY", from: "2027-01-01" })).pagination.total, 0);
  const item = result.rows.find(row => row.kind === "PROMOTION_ITEM")!;
  assert.equal((item.facts as { item: { budget: { value: string } } }).item.budget.value, "123456789.123456789");
  assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 6);
  const pair = { sellerAccountId: f.sellerAccountId, marketplaceId: site };
  const tools = ["promotions_search", "promotions_get", "promotions_get_items"];
  const credential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "promotion fixture", scopes: [{ sellerAccountId: f.sellerAccountId, marketplaceIds: [site] }], tools, expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp("Bearer " + credential.token!);
  for (const tool of tools) {
    const output = await invokeAmazonMcp(identity, tool, { ...pair, ...(tool === "promotions_search" ? {} : { promotionId: "promo-one" }) });
    assert.ok(JSON.stringify(output).includes("promo-one"), JSON.stringify(output));
  }
  const requests = f.calls.length;
  await assert.rejects(() => invokeAmazonMcp(identity, "promotions_get", { ...pair, sellerAccountId: randomUUID(), promotionId: "promo-one" }));
  await assert.rejects(() => invokeAmazonMcp(identity, "promotions_get_items", { ...pair, marketplaceId: "FOREIGN", promotionId: "promo-one" }));
  assert.equal(f.calls.length, requests, "local query must never call Amazon");
  const erp = await createErpResearchTransport({ ...f.scope, userId: f.actor });
  assert.ok(erp.transport);
  for (const tool of tools) {
    const lili = await erp.transport.callTool(tool, { ...pair, ...(tool === "promotions_search" ? {} : { promotionId: "promo-one" }) }, new AbortController().signal);
    assert.ok(JSON.stringify(lili).includes("promo-one"), JSON.stringify(lili));
  }
  assert.equal(f.calls.length, requests, "MCP and Lili reads must stay local");
});

test("promotions: failed completeness and foreign detail keep last good head", async () => {
  const f = await fresh("promotions"), run = await f.start();
  assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  for (const mode of ["gap", "bad-detail", "summary-drift", "stale-detail"]) {
    f.setMode(mode); const failed = await f.start(); const done = await f.finish(failed.id); assert.notEqual(done.status, "SUCCEEDED");
    assert.equal((await f.read()).run?.id, run.id);
  }
  f.setMode("expired"); const next = await f.start(); assert.equal((await f.finish(next.id)).status, "SUCCEEDED");
  assert.equal((await f.read({ kind: "PROMOTION_SUMMARY", status: "EXPIRED" })).pagination.total, 1);
});

test("promotions: insertion failure reparses same archived page and publication failure recovers without HTTP", async () => {
  const f = await fresh("promotions"), run = await f.start();
  await f.slice(run.id); await f.slice(run.id); await f.slice(run.id);
  await prisma.$executeRawUnsafe("CREATE SEQUENCE fixture_promotions_insert_attempt");
  await prisma.$executeRawUnsafe("CREATE FUNCTION fixture_promotions_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='PROMOTION_ITEM' AND nextval('fixture_promotions_insert_attempt')=1 THEN RAISE EXCEPTION 'fixture insert interruption' USING ERRCODE='40001'; END IF; RETURN NEW; END $$");
  await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_promotions_insert_failure BEFORE INSERT ON "AmazonDomainObservation" FOR EACH ROW EXECUTE FUNCTION fixture_promotions_insert_failure()');
  try {
    const interrupted = await f.slice(run.id); assert.equal(interrupted.status, "RETRY_WAIT", interrupted.error ?? "");
    const archive = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: run.id, page: 4 } });
    const raw = unseal(archive.rawCiphertext, f.scope, run.id + ":4", "amazon-observation-raw.v1").rawBody;
    assert.equal(digest(raw), archive.bodySha256);
    assert.equal(await prisma.amazonDomainObservation.count({ where: { sourceRunId: run.id, kind: "PROMOTION_ITEM" } }), 0);
    const requests = f.calls.length; await f.slice(run.id); assert.equal(f.calls.length, requests);
  } finally { await prisma.$executeRawUnsafe('DROP TRIGGER fixture_promotions_insert_failure ON "AmazonDomainObservation"'); await prisma.$executeRawUnsafe('DROP FUNCTION fixture_promotions_insert_failure()'); }
  await f.slice(run.id); await f.slice(run.id);
  await prisma.$executeRawUnsafe("CREATE SEQUENCE fixture_promotions_publish_attempt");
  await prisma.$executeRawUnsafe("CREATE FUNCTION fixture_promotions_publish_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource='promotions' AND NEW.\"activeRunId\" IS DISTINCT FROM OLD.\"activeRunId\" AND nextval('fixture_promotions_publish_attempt')=1 THEN RAISE EXCEPTION 'fixture publication interruption' USING ERRCODE='40001'; END IF; RETURN NEW; END $$");
  await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_promotions_publish_failure BEFORE UPDATE ON "AmazonSyncDataSource" FOR EACH ROW EXECUTE FUNCTION fixture_promotions_publish_failure()');
  try {
    const interrupted = await f.slice(run.id); assert.equal(interrupted.status, "RETRY_WAIT", interrupted.error ?? "");
    assert.equal((await f.read()).rows.length, 0);
    const requests = f.calls.length; const done = await f.finish(run.id); assert.equal(done.status, "SUCCEEDED", done.error ?? ""); assert.equal(f.calls.length, requests);
    const again = await f.slice(run.id); assert.equal(again.status, "SUCCEEDED"); assert.equal(f.calls.length, requests);
  } finally { await prisma.$executeRawUnsafe('DROP TRIGGER fixture_promotions_publish_failure ON "AmazonSyncDataSource"'); await prisma.$executeRawUnsafe('DROP FUNCTION fixture_promotions_publish_failure()'); }
});

test("promotions: unchanged old terminal details reuse with original capture time", async () => {
  const f = await fresh("promotions"); f.setMode("old-expired"); const first = await f.start(); assert.equal((await f.finish(first.id)).status, "SUCCEEDED");
  const initial = await f.read(), detail = initial.rows.find(row => row.kind === "PROMOTION")!;
  const requests = f.calls.length, second = await f.start(); assert.equal((await f.finish(second.id)).status, "SUCCEEDED");
  assert.equal(f.calls.length - requests, 4, "only two search pages and fixture token requests; no detail/item refetch");
  const next = await f.read(); assert.equal(next.pagination.total, initial.pagination.total); assert.equal(next.rows.find(row => row.kind === "PROMOTION")!.capturedAt.toISOString(), detail.capturedAt.toISOString());
});

test("promotions: registered Worker SIGKILL, lease recovery and same checkpoint publication", { timeout: 120000 }, async () => {
  const f = await fresh("promotions", {}, true), run = await f.start();
  const directory = await mkdtemp(path.join(tmpdir(), "promotions-process-"));
  const fixture = { clock: path.join(directory, "clock"), calls: path.join(directory, "calls"), held: path.join(directory, "held"), release: path.join(directory, "release"), detail: { promotionId: "promo-one", marketplaceId: site, promotionType: "COUPON", status: "RUNNING", promotionTitle: "Process fixture", trackingId: "track", createdDate: "2026-09-01T00:00:00Z", lastUpdatedDate: "2026-10-10T00:00:00Z", schedule: { startDate: "2026-10-01T00:00:00Z", endDate: "2026-11-30T00:00:00Z" }, selection: { type: "ITEMS", selectionId: "selection-one", revisionId: 1 } } };
  const file = path.join(directory, "fixture.json"); await writeFile(file, JSON.stringify(fixture)); await writeFile(fixture.clock, "0"); await writeFile(fixture.calls, "");
  const env = { ...process.env, ERP_RUNTIME_MODE: "production", QUEUE_DRIVER: "redis", AMAZON_SYNC_WORKER_MODE: "approved-only", AMAZON_SYNC_WORKER_TASK_IDS: JSON.stringify([run.id]), AMAZON_SYNC_WORKER_ID: "promotions-fixture-worker", AMAZON_SYNC_WORKER_NAME: "promotions-fixture-worker", AMAZON_SYNC_CENTER_SCOPES: JSON.stringify([[f.scope.organizationId, f.scope.workspaceId]]), AMAZON_PROMOTIONS_PROCESS_FIXTURE: file, NODE_OPTIONS: "--import=" + pathToFileURL(path.resolve("tests/helpers/amazon-promotions-process-preload.mjs")).href };
  const child = spawn(process.execPath, ["scripts/runtime/worker-manager.mjs", "amazon-sync"], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; child.stdout.on("data", value => { logs += String(value); }); child.stderr.on("data", value => { logs += String(value); });
  const until = async (fn: () => Promise<boolean>, label: string) => { const start = Date.now(); while (Date.now() - start < 60000) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(label + " " + logs); };
  try {
    // Advance only the child's fixture clock to release quota slots.
    await until(async () => { const task = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } }); await writeFile(fixture.clock, String(task.pagesCompleted * 11000)); try { await access(fixture.held); return true; } catch { return false; } }, "Worker did not reach held second selection page");
    const before = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } }); assert.equal(before.pagesCompleted, 3);
    const heartbeat = await prisma.workerHeartbeat.findUniqueOrThrow({ where: { id: "promotions-fixture-worker" } }); const pid = (heartbeat.metadata as { pid: number }).pid; assert.ok(pid > 0 && pid !== child.pid);
    process.kill(pid, "SIGKILL"); await writeFile(fixture.release, "release"); await writeFile(fixture.clock, "400000");
    await until(async () => { const task = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } }); return task.status === "SUCCEEDED"; }, "Worker failed to recover same task");
    const done = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } }); assert.equal(done.pagesCompleted, 5); assert.ok(done.dispatchVersion > before.dispatchVersion);
    const calls = (await readFile(fixture.calls, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { path: string; token: string | null });
    assert.equal(calls.filter(call => call.path === "/promotions/2025-12-01/promotions").length, 1);
    assert.equal(calls.filter(call => call.path.endsWith("/selections/selection-one") && call.token === null).length, 1);
    assert.equal((await f.read({ kind: "PROMOTION_ITEM" })).pagination.total, 1);
  } finally {
    child.kill("SIGTERM"); await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 26000))]);
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* Only this fixture group. */ }
    await rm(directory, { recursive: true, force: true });
  }
});

test("promotions: upstream absence retains historical facts without asserting current presence", async () => {
  const f = await fresh("promotions"), first = await f.start(); assert.equal((await f.finish(first.id)).status, "SUCCEEDED");
  f.setMode("no-longer-returned"); const next = await f.start(); assert.equal((await f.finish(next.id)).status, "SUCCEEDED");
  const result = await f.read(); assert.equal(result.pagination.total, 5);
  assert.equal((result.rows[0].facts as { observation: { currentDiscovery: boolean } }).observation.currentDiscovery, false);
});

test("promotions: live ERP assignment revocation rejects MCP and Lili identities", async () => {
  const f = await fresh("promotions"), run = await f.start(); assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
  const pair = { sellerAccountId: f.sellerAccountId, marketplaceId: site }, erp = await createErpResearchTransport({ ...f.scope, userId: f.actor }); assert.ok(erp.transport);
  await prisma.amazonDataAccessGrant.deleteMany({ where: { ...f.scope, userId: f.actor, sellerAccountId: f.sellerAccountId } });
  await assert.rejects(() => erp.transport!.callTool("promotions_get", { ...pair, promotionId: "promo-one" }, new AbortController().signal));
  await assert.rejects(() => f.read());
});

test("promotions: registry discovers eligible marketplace, creates plan and task idempotently", async () => {
  const f = await fresh("promotions");
  await prisma.amazonSyncDataSource.delete({ where: { id: f.sourceId } });
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authorizationId }, data: { lastValidatedAt: new Date(), approvedRoles: [], rolesAttestedAt: null } });
  await ensureAmazonSyncInitialized(f.scope, f.authorizationId);
  assert.equal(await prisma.amazonSyncDataSource.count({ where: { ...f.scope, resource: "promotions" } }), 0);
  await prisma.amazonSpApiAuthorization.update({ where: { id: f.authorizationId }, data: { approvedRoles: ["Pricing"], rolesAttestedAt: new Date() } });
  await ensureAmazonSyncInitialized(f.scope, f.authorizationId);
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...f.scope, resource: "promotions" } });
  const plan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { ...f.scope, resource: "promotions", targets: { some: { sourceId: source.id } } } });
  assert.equal(plan.mode, "snapshot"); assert.equal(plan.intervalMinutes, 360);
  const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: source.id, trigger: "schedule" } });
  await ensureAmazonSyncInitialized(f.scope, f.authorizationId);
  assert.equal(await prisma.amazonSyncDataSource.count({ where: { ...f.scope, resource: "promotions" } }), 1);
  assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: source.id } }), 1);
  assert.equal((await f.finish(run.id)).status, "SUCCEEDED");
});

test("promotions: two real fixture tenants/accounts and two marketplaces never mix query results", async () => {
  const first = await fresh("promotions"), second = await fresh("promotions", {}, false, "A2EUQ1WTGCTBG2");
  for (const f of [first, second]) { const run = await f.start(); assert.equal((await f.finish(run.id)).status, "SUCCEEDED"); }
  const a = await first.read(), b = await second.read(); assert.notEqual(a.run!.id, b.run!.id);
  assert.ok(a.rows.every(row => row.sourceId === first.sourceId)); assert.ok(b.rows.every(row => row.sourceId === second.sourceId));
  await assert.rejects(() => first.read({ sourceId: second.sourceId, sellerAccountId: second.sellerAccountId, marketplaceId: "A2EUQ1WTGCTBG2" }));
  await assert.rejects(() => first.read({ marketplaceId: "A2EUQ1WTGCTBG2" }));
  await assert.rejects(() => readObservations(first.scope, new URLSearchParams({ resource: "promotions", sellerAccountId: first.sellerAccountId }), first.actor));
});

if (process.env.AMAZON_PROMOTIONS_HTTP_FIXTURE == "1") registerPromotionsHttpAcceptance(fresh);
