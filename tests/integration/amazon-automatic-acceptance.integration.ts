import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { startAmazonOAuth, finishAmazonOAuth } from "@/lib/amazon-sync/oauth";
import { ensureAmazonSyncInitialized, enqueueDueAutomaticPlans, tickSyncCenter } from "@/lib/amazon-sync/scheduler";
import { encryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { ensureAutomaticConnections } from "@/lib/amazon-sync/automatic-connection";
import { automaticAdapters, automaticAdapterHasRequiredRoles } from "@/lib/amazon-sync/automatic-adapters";
import { discoverProductObjects } from "@/lib/amazon-sync/product-discovery";
import { parseObservationPolicy } from "@/lib/amazon-sync/observation-policy";
import { planAutomaticTask } from "@/lib/amazon-sync/automatic-planner";
import { localDate, reportTimeZone, shiftDate, resolveRequestedRange } from "@/lib/amazon-sync/date-range";
import { readAutomaticDayHistory } from "@/lib/amazon-sync/automatic-day-history";
import { parseFinancePolicy } from "@/lib/amazon-sync/finance";
import { automaticAdapter } from "@/lib/amazon-sync/automatic-adapters";
import { domainReportTypes } from "@/lib/amazon-sync/domain-reports";
import { readSalesHistoryCoverage } from "@/lib/amazon-sync/sales-history";
import { nextSalesTrafficRange } from "@/lib/amazon-sync/automatic-schedule";
import { readSyncCoverage } from "@/lib/amazon-sync/coverage";
import { persistWindowCheckpoints } from "@/lib/amazon-sync/window-checkpoints";
import { readSalesTraffic } from "@/lib/amazon-sync/sales-query";
import { createTask } from "@/lib/amazon-sync/service";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { createSession } from "@/lib/auth/session";
import { GET as erpRead } from "@/app/api/operations/sync-center/route";
import { authenticateAmazonMcp, invokeAmazonMcp, mcpTokenHash } from "@/lib/amazon-sync/mcp";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1" || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw new Error("Disposable offline runner required");
after(async () => { await getAmazonSyncQueue().close(); await prisma.$disconnect(); });

test("new multi-site OAuth automatically binds, schedules, recovers, publishes and serves identical ERP/MCP pages", async t => {
  const scope = { organizationId: randomUUID(), workspaceId: "default" }, actor = randomUUID();
  const site = "ATVPDKIKX0DER", secondSite = "A2EUQ1WTGCTBG2";
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 74).toString("base64");
  process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId]]);
  process.env.QUEUE_DRIVER = "redis";
  process.env.AMAZON_SP_API_APPLICATION_ID = "fixture-automatic-app";
  process.env.AMAZON_SP_API_LWA_CLIENT_ID = "fixture-automatic-client";
  process.env.AMAZON_SP_API_LWA_CLIENT_SECRET = "fixture-automatic-secret";
  process.env.AMAZON_SP_API_OAUTH_REDIRECT_URI = "http://localhost/api/integrations/amazon/sp-api/oauth/callback";
  await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Automatic acceptance fixture" } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Fixture" } });
  await prisma.user.create({ data: { id: actor, email: `${actor}@fixture.invalid`, name: "Fixture", passwordHash: "not-login", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  const financeRequests: Array<{ postedAfter: string | null; postedBefore: string | null }> = [];
  let failure: number | null = null;
  globalThis.fetch = async input => {
    const url = new URL(String(input)); calls.push(url.pathname + url.search);
    if (url.hostname === "api.amazon.com" || url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-token", refresh_token: "fixture-refresh", expires_in: 3600 });
    assert.equal(url.hostname, "sellingpartnerapi-na.amazon.com");
    if (url.pathname.includes("marketplaceParticipations")) return Response.json({ payload: [site, secondSite].map(id => ({ marketplace: { id }, participation: { isParticipating: true } })) });
    if (url.pathname === "/finances/2024-06-19/transactions") {
      const postedAfter = url.searchParams.get("postedAfter"), postedBefore = url.searchParams.get("postedBefore");
      financeRequests.push({ postedAfter, postedBefore });
      if (!postedAfter || !postedBefore) throw new Error("Finance fixture requires the frozen request window");
      const postedDate = new Date(Date.parse(postedAfter) + 1).toISOString();
      return Response.json({ payload: { transactions: [{ transactionId: "fixture-history-replay", postedDate, transactionType: "Shipment", transactionStatus: "Released",
        sellingPartnerMetadata: { sellingPartnerId: "AUTOFIXTURE1", marketplaceId: site }, marketplaceDetails: { marketplaceId: site }, totalAmount: { currencyCode: "USD", currencyAmount: 12.34 } }] } });
    }
    if (url.pathname === "/listings/2021-08-01/items/AUTOFIXTURE1") return Response.json({ items: [] });
    if (url.pathname.includes("/fba/inventory/")) {
      if (failure) return Response.json({ errors: [{ code: "FixtureFailure" }] }, { status: failure });
      const second = url.searchParams.has("nextToken");
      return Response.json({ payload: { inventorySummaries: [{ sellerSku: second ? "FIXTURE-2" : "FIXTURE-1", asin: "B012345678", condition: "NewItem", totalQuantity: 3, inventoryDetails: { fulfillableQuantity: 3, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: { totalReservedQuantity: 0 }, unfulfillableQuantity: { totalUnfulfillableQuantity: 0 }, researchingQuantity: { totalResearchingQuantity: 0 } } }] }, ...(second ? {} : { pagination: { nextToken: "fixture-next" } }) }, { headers: { "x-amzn-RateLimit-Limit": "0.1" } });
    }
    throw new Error(`Unexpected fixture operation ${url.pathname}`);
  };
  try {
    const started = await startAmazonOAuth(scope, actor, "us-east-1");
    const completed = await finishAmazonOAuth(actor, new URLSearchParams({ state: new URL(started.consentUrl).searchParams.get("state")!, selling_partner_id: "AUTOFIXTURE1", spapi_oauth_code: "fixture-code" }));
    if (completed.automaticSync.status === "deferred") await ensureAmazonSyncInitialized(scope, completed.authorizationId);
    const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: completed.authorizationId } });
    const authorization = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: completed.authorizationId } });
    const eligibleAdapters = automaticAdapters.filter(adapter => automaticAdapterHasRequiredRoles(adapter, !!authorization.rolesAttestedAt, authorization.approvedRoles));
    const sellerAccountId = sources[0].sellerAccountId;
    const source = sources.find(s => s.resource === "inventory" && s.marketplaceId === site)!;
    let run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, sourceId: source.id, trigger: "schedule" } });
    await t.test("all registered resources are discovered, seller APIs share one account and initialization is idempotent", async () => {
      assert.equal(new Set(sources.map(s => s.sellerAccountId)).size, 1);
      assert.equal(sources.length, eligibleAdapters.reduce((n, a) => n + (a.discoveryScope === "seller" ? 1 : 2), 0));
      for (const adapter of automaticAdapters.filter(adapter => !eligibleAdapters.includes(adapter))) {
        assert.equal(sources.some(source => source.resource === adapter.resource), false, `${adapter.resource} waits for attested roles`);
      }
      assert.ok(sources.some(s => s.resource === "finance"));
      assert.ok(sources.some(s => s.resource === "notifications"));
      assert.equal(await prisma.amazonDataAccessGrant.count({ where: { ...scope, userId: actor, sellerAccountId, enabled: true } }), 1);
      const count = async () => Promise.all([prisma.amazonSyncDataSource.count({ where: scope }), prisma.amazonSyncSchedule.count({ where: scope }), prisma.amazonSyncRun.count({ where: scope })]);
      const before = await count();
      assert.equal(before[1], sources.length);
      await ensureAmazonSyncInitialized(scope, completed.authorizationId);
      assert.deepEqual(await count(), before);
    });
    const slice = async (version?: number) => {
      await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date(0) } });
      await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: completed.authorizationId }, data: { nextRequestAt: new Date(0) } });
      await processSyncCenterTask(run.id, version ?? run.dispatchVersion);
      run = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
    };
    await t.test("first page commits archive and facts without publishing incomplete pagination", async () => {
      await slice();
      assert.equal(run.status, "WAITING", run.error ?? "");
      assert.equal(run.pagesCompleted, 1);
      assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 1);
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, null);
    });
    await t.test("lost Redis, expired lease and publication database failure recover without refetching committed pages", async () => {
      const queue = getAmazonSyncQueue();
      const oldJob = await queue.getJob(`adc-${run.id}-${run.dispatchVersion}`); if (oldJob) await oldJob.remove();
      const oldVersion = run.dispatchVersion, checkpoint = run.checkpointCiphertext;
      await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { status: "RUNNING", leaseOwner: "dead-fixture-worker", leaseExpiresAt: new Date(0) } });
      await tickSyncCenter(new Date(), { taskIds: [run.id], exportIds: [] });
      run = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(run.status, "RETRY_WAIT"); assert.equal(run.checkpointCiphertext, checkpoint);
      assert.ok(await queue.getJob(`adc-${run.id}-${run.dispatchVersion}`));
      const before = calls.length;
      await processSyncCenterTask(run.id, oldVersion);
      assert.equal(calls.length, before);
      // Fail the publication transaction after both page commits. A real SQL
      // serialization failure exercises Prisma and the worker's retry path.
      await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_reject_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."activeRunId" IS DISTINCT FROM OLD."activeRunId" THEN RAISE EXCEPTION 'fixture publication interruption' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_reject_publication BEFORE UPDATE ON "AmazonSyncDataSource" FOR EACH ROW EXECUTE FUNCTION fixture_reject_publication()`);
      try {
        await slice();
        assert.equal(run.status, "RETRY_WAIT", run.error ?? "");
        assert.equal(run.paginationComplete, true);
        assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, null);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER fixture_reject_publication ON "AmazonSyncDataSource"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION fixture_reject_publication()`);
      }
      const requestsBeforePublish = calls.length;
      await slice(); assert.equal(run.status, "SUCCEEDED", run.error ?? "");
      assert.equal(calls.length, requestsBeforePublish, "publication recovery must reuse committed pages");
      assert.ok(calls.some(c => c.includes("nextToken=fixture-next")));
      assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: run.id } }), 2);
      assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: run.id } }), 2);
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, run.id);
    });
    await t.test("duplicate successful execution performs no HTTP or duplicate publication", async () => {
      const before = calls.length;
      await processSyncCenterTask(run.id, run.dispatchVersion);
      assert.equal(calls.length, before);
      assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: run.id } }), 2);
    });
    await t.test("ERP authenticated route and MCP return the same first and last published pages", async () => {
      const session = await createSession(actor), token = "amcp_" + "a".repeat(43);
      await prisma.amazonMcpCredential.create({ data: { ...scope, id: randomUUID(), userId: actor, name: "Fixture", tokenHash: mcpTokenHash(token), tokenPrefix: token.slice(0, 12), scopes: [], tools: [], createdByUserId: actor, expiresAt: new Date(Date.now() + 3600000) } });
      const context = await authenticateAmazonMcp(`Bearer ${token}`);
      for (const page of [1, 2]) {
        const args = { table: "inventory", sellerAccountId, marketplaceId: site, page, pageSize: 1 };
        const params = new URLSearchParams({ workspaceId: scope.workspaceId, section: "data", ...Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)])) });
        const response = await erpRead(new Request(`http://fixture/api/operations/sync-center?${params}`, { headers: { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }));
        assert.equal(response.status, 200, await response.clone().text());
        const erp = await response.json();
        const mcp = await invokeAmazonMcp(context, "data_query", args) as { data: unknown };
        assert.deepEqual(erp.data, JSON.parse(JSON.stringify(mcp.data)));
        assert.equal(erp.data.total, 2);
      }
    });
    await t.test("throttling schedules bounded automatic retry without publishing partial data", async () => {
      const other = sources.find(s => s.resource === "inventory" && s.marketplaceId === secondSite)!;
      const task = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: other.id } });
      failure = 429;
      await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: completed.authorizationId }, data: { nextRequestAt: new Date(0) } });
      await processSyncCenterTask(task.id, task.dispatchVersion);
      const retrying = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(retrying.status, "RETRY_WAIT");
      assert.equal(retrying.throttles, 1);
      assert.equal(retrying.attempts, 1);
      assert.ok(retrying.nextAttemptAt.getTime() > Date.now());
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: other.id } })).activeRunId, null);
    });
    await t.test("exhausted transient retries cool down then automatically resume the original task", async () => {
      const other = sources.find(s => s.resource === "inventory" && s.marketplaceId === secondSite)!;
      let task = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: other.id } });
      while (task.status === "RETRY_WAIT" && task.attempts < task.maxAttempts + 2) {
        await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: completed.authorizationId }, data: { nextRequestAt: new Date(0) } });
        await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { nextAttemptAt: new Date(0) } });
        await processSyncCenterTask(task.id, task.dispatchVersion);
        task = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
      }
      assert.equal(task.status, "FAILED");
      await tickSyncCenter(new Date(task.finishedAt!.getTime() + 60_000), { taskIds: [task.id], exportIds: [] });
      assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "FAILED", "cooldown prevents immediate retry loops");
      const beforeCalls = calls.length;
      await prisma.amazonSyncSchedule.update({ where: { id: task.scheduleId! }, data: { nextRunAt: new Date(0) } });
      await enqueueDueAutomaticPlans([scope], new Date(task.finishedAt!.getTime() + 60_000), [other.id]);
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: other.id } }), 1, "new cadence must not replace exhausted work during recovery cooldown");
      const resumedAt = new Date(task.finishedAt!.getTime() + 16 * 60_000);
      await tickSyncCenter(resumedAt, { taskIds: [task.id], exportIds: [] });
      await tickSyncCenter(resumedAt, { taskIds: [task.id], exportIds: [] });
      const recovered = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(recovered.status, "RETRY_WAIT");
      assert.equal(recovered.attempts, task.attempts, "lifetime attempt count is retained");
      assert.equal(recovered.maxAttempts, Math.max(task.attempts, task.maxAttempts) + 3);
      assert.equal(recovered.frozenScopeDigest, task.frozenScopeDigest);
      assert.equal(recovered.checkpointCiphertext, task.checkpointCiphertext);
      assert.equal(await prisma.amazonSyncTaskLog.count({ where: { taskId: task.id, event: "AUTOMATIC_RECOVERY" } }), 1);
      assert.equal(calls.length, beforeCalls, "coordinator performs no Amazon request");
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: other.id } }), 1);
    });
    await t.test("permission rejection terminates only the affected site task without infinite retries", async () => {
      const other = sources.find(s => s.resource === "inventory" && s.marketplaceId === secondSite)!;
      const task = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: other.id } });
      failure = 403;
      await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: completed.authorizationId }, data: { nextRequestAt: new Date(0) } });
      await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { nextAttemptAt: new Date(0) } });
      await processSyncCenterTask(task.id, task.dispatchVersion);
      const failed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(failed.status, "FAILED");
      await tickSyncCenter(new Date(Date.now() + 2 * 86400_000), { taskIds: [task.id], exportIds: [] });
      assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } })).status, "FAILED", "permission rejection must never auto-recover");
      await prisma.amazonSyncSchedule.update({ where: { id: task.scheduleId! }, data: { nextRunAt: new Date(0) } });
      await enqueueDueAutomaticPlans([scope], new Date(Date.now() + 2 * 86400_000), [other.id]);
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: other.id } }), 1, "new schedule slots must not bypass an upstream permission rejection");
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, run.id);
    });
    await t.test("completed source schedules its next refresh automatically and repeated scheduling is idempotent", async () => {
      failure = null;
      const plan = await prisma.amazonSyncSchedule.findUniqueOrThrow({ where: { id: run.scheduleId! } });
      assert.equal(plan.intervalMinutes, automaticAdapters.find(a => a.resource === "inventory")!.intervalMinutes);
      await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { nextRunAt: new Date(0) } });
      const nextSlot = new Date(Date.now() + plan.intervalMinutes * 60_000);
      await enqueueDueAutomaticPlans([scope], nextSlot, [source.id]);
      await enqueueDueAutomaticPlans([scope], nextSlot, [source.id]);
      const tasks = await prisma.amazonSyncRun.findMany({ where: { sourceId: source.id } });
      assert.equal(tasks.length, 2);
      assert.equal(tasks.filter(task => task.id !== run.id && ["WAITING", "QUEUED"].includes(task.status)).length, 1);
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, run.id);
    });
    await t.test("exhausted worker leases recover after cooldown but a disabled plan remains stopped", async () => {
      const pending = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: source.id, id: { not: run.id } } });
      await prisma.amazonSyncRun.update({ where: { id: pending.id }, data: { status: "RUNNING", attempts: pending.maxAttempts, leaseOwner: "dead-worker-final-attempt", leaseExpiresAt: new Date(0) } });
      await tickSyncCenter(new Date(), { taskIds: [pending.id], exportIds: [] });
      const failed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: pending.id } });
      assert.equal(failed.status, "FAILED");
      assert.equal((failed.summary as { quality: { code: string } }).quality.code, "WORKER_INTERRUPTED");
      const later = new Date(failed.finishedAt!.getTime() + 16 * 60_000);
      await prisma.amazonSyncSchedule.update({ where: { id: pending.scheduleId! }, data: { enabled: false } });
      await tickSyncCenter(later, { taskIds: [pending.id], exportIds: [] });
      assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: pending.id } })).status, "FAILED");
      await prisma.amazonSyncSchedule.update({ where: { id: pending.scheduleId! }, data: { enabled: true } });
      const newer = await prisma.amazonSyncRun.create({ data: { ...scope, id: randomUUID(), requestedByUserId: actor, sourceId: source.id, resource: "inventory", executionVersion: 2, status: "SUCCEEDED", stage: "COMPLETED", startedAt: new Date(pending.startedAt.getTime() + 1) } });
      await prisma.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: newer.id } });
      await tickSyncCenter(new Date(later.getTime() + 16 * 60_000), { taskIds: [pending.id], exportIds: [] });
      assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: pending.id } })).status, "FAILED", "older failure cannot replace a newer publication");
      await prisma.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id } });
      await tickSyncCenter(new Date(later.getTime() + 32 * 60_000), { taskIds: [pending.id], exportIds: [] });
      assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: pending.id } })).status, "RETRY_WAIT");
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, run.id);
    });
    await t.test("one full batch of invalid old tasks cannot starve later recoverable work", async () => {
      const pending = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: source.id, status: "RETRY_WAIT" } });
      const now = new Date();
      await prisma.amazonSyncRun.update({ where: { id: pending.id }, data: { status: "FAILED", finishedAt: new Date(now.getTime() - 60 * 60_000), nextAttemptAt: new Date(0), summary: { quality: { code: "DATABASE_TRANSIENT" } } } });
      const blockedIds = Array.from({ length: 100 }, () => randomUUID());
      await prisma.amazonSyncRun.createMany({ data: blockedIds.map(id => ({ ...scope, id, resource: "inventory", executionVersion: 2,
        sourceId: source.id, requestedByUserId: actor, trigger: "schedule", status: "FAILED", attempts: 3, maxAttempts: 3,
        scheduleId: pending.scheduleId, scheduleRevision: pending.scheduleRevision! + 1, authorizationRevision: pending.authorizationRevision,
        frozenScope: pending.frozenScope as Prisma.InputJsonValue, frozenScopeDigest: pending.frozenScopeDigest,
        summary: { quality: { code: "TRANSIENT" } }, nextAttemptAt: new Date(0), finishedAt: new Date(now.getTime() - 2 * 60 * 60_000),
      })) });
      const beforeCalls = calls.length;
      const only = { taskIds: [...blockedIds, pending.id], exportIds: [] };
      const first = await tickSyncCenter(now, only);
      assert.equal(first?.automaticRecoveries, 0);
      assert.equal(await prisma.amazonSyncRun.count({ where: { id: { in: blockedIds }, status: "FAILED", nextAttemptAt: { gt: now } } }), 100);
      const second = await tickSyncCenter(now, only);
      assert.equal(second?.automaticRecoveries, 1);
      assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: pending.id } })).status, "RETRY_WAIT");
      assert.equal(calls.length, beforeCalls);
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, run.id);
    });
    await t.test("a full batch of occupied plans cannot starve an independent due resource", async () => {
      const age = sources.find(s => s.resource === "inventory_age" && s.marketplaceId === site)!;
      await prisma.amazonSyncRun.updateMany({ where: { sourceId: age.id }, data: { status: "CANCELLED" } });
      const agePlan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { targets: { some: { sourceId: age.id } } } });
      await prisma.amazonSyncSchedule.update({ where: { id: agePlan.id }, data: { nextRunAt: new Date(1) } });
      const blocked = Array.from({ length: 100 }, () => randomUUID());
      await prisma.amazonSyncSchedule.createMany({ data: blocked.map(id => ({ ...scope, id, resource: "inventory", executionVersion: 2, planKey: `auto-v1:fixture-${id}`, enabled: true, nextRunAt: new Date(0), updatedByUserId: actor })) });
      await prisma.amazonSyncPlanTarget.createMany({ data: blocked.map(scheduleId => ({ ...scope, scheduleId, sourceId: source.id })) });
      const now = new Date(Date.now() + 2 * 86400_000), before = await prisma.amazonSyncRun.count({ where: { sourceId: age.id } });
      const beforeCalls = calls.length;
      await enqueueDueAutomaticPlans([scope], now, [source.id, age.id]);
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: age.id } }), before);
      assert.equal(await prisma.amazonSyncSchedule.count({ where: { id: { in: blocked }, nextRunAt: { gt: now } } }), 100);
      await enqueueDueAutomaticPlans([scope], now, [source.id, age.id]);
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: age.id } }), before + 1);
      assert.equal(calls.length, beforeCalls);
    });
    await t.test("published empty catalog automatically releases dependent adapters without requests or fabricated rows", async () => {
      const catalog = sources.find(s => s.resource === "catalog" && s.marketplaceId === site)!;
      const upstream = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: catalog.id } });
      await prisma.amazonSyncRun.update({ where: { id: upstream.id }, data: { nextAttemptAt: new Date(0) } });
      await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: completed.authorizationId }, data: { nextRequestAt: new Date(0) } });
      await processSyncCenterTask(upstream.id, upstream.dispatchVersion);
      const published = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: upstream.id } });
      assert.equal(published.status, "SUCCEEDED", published.error ?? "");
      assert.equal(published.insertedCount, 0);
      assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: upstream.id } }), 1);
      const dependentIds = sources.filter(s => s.marketplaceId === site && ["listing_details", "catalog_items", "pricing"].includes(s.resource)).map(s => s.id);
      const detail = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { id: dependentIds[0] }, include: { authorization: true } });
      const policy = parseObservationPolicy(detail.domainPolicy);
      await prisma.amazonSyncRun.update({ where: { id: upstream.id }, data: { paginationComplete: false } });
      await assert.rejects(prisma.$transaction(tx => discoverProductObjects(tx, scope, detail, policy)), /完整在线商品快照/);
      await prisma.amazonSyncRun.update({ where: { id: upstream.id }, data: { paginationComplete: true, summary: { coverage: { type: "complete_snapshot", paginationComplete: true, rowCount: 1 } } } });
      await assert.rejects(prisma.$transaction(tx => discoverProductObjects(tx, scope, detail, policy)), /完整在线商品快照/);
      await prisma.amazonSyncRun.update({ where: { id: upstream.id }, data: { summary: published.summary as Prisma.InputJsonValue } });
      // Remove the old startup intents to exercise ordinary automatic planning
      // from the published dependency, rather than a manual run or initialization.
      for (const id of dependentIds) {
        const old = await prisma.amazonSyncRun.findFirst({ where: { sourceId: id } });
        if (old) await prisma.amazonSyncRun.update({ where: { id: old.id }, data: { status: "CANCELLED" } });
      }
      const due = new Date(Date.now() + 2 * 86400000);
      await prisma.amazonSyncSchedule.updateMany({ where: { ...scope, targets: { some: { sourceId: { in: dependentIds } } } }, data: { nextRunAt: due } });
      const beforeCalls = calls.length;
      await enqueueDueAutomaticPlans([scope], due, dependentIds);
      const tasks = await prisma.amazonSyncRun.findMany({ where: { sourceId: { in: dependentIds }, status: "WAITING" } });
      assert.equal(tasks.length, 3);
      for (const task of tasks) {
        assert.equal((task.frozenScope as { productManifest: { total: number; runId: string } }).productManifest.total, 0);
        assert.equal((task.frozenScope as { productManifest: { runId: string } }).productManifest.runId, upstream.id);
        await processSyncCenterTask(task.id, task.dispatchVersion);
        const finished = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
        assert.equal(finished.status, "SUCCEEDED", finished.error ?? "");
        assert.equal((finished.summary as { coverage: { noData: boolean } }).coverage.noData, true);
        assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: task.sourceId! } })).activeRunId, task.id);
        assert.equal(await prisma.amazonDomainObservation.count({ where: { sourceRunId: task.id } }), 0);
      }
      assert.equal(calls.length, beforeCalls, "verified empty catalog must not issue detail or pricing calls");
      await enqueueDueAutomaticPlans([scope], due, dependentIds);
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: { in: dependentIds }, status: "SUCCEEDED" } }), 3);
    });
    await t.test("same Seller OAuth renewal preserves history and rebinds only live automatic plans to resume archived pagination", async () => {
      const sales = sources.find(s => s.resource === "sales_traffic" && s.marketplaceId === site)!;
      const original = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: sales.id } });
      const frozen = original.frozenScope as Prisma.JsonObject;
      const requestedRange = frozen.requestedRange as { from: string; to: string };
      const history = await prisma.amazonSyncRun.create({ data: { ...scope, id: randomUUID(), resource: "sales_traffic", sourceId: sales.id,
        requestedByUserId: actor, authorizationRevision: original.authorizationRevision, executionVersion: 2, mode: "date_range", status: "SUCCEEDED", stage: "COMPLETED",
        paginationComplete: true, finishedAt: new Date(), frozenScope: frozen as Prisma.InputJsonObject, frozenScopeDigest: original.frozenScopeDigest, summary: { coverage: { complete: true } } } });
      const params = new URLSearchParams({ sellerAccountId, marketplaceId: site });
      const before = await readSyncCoverage(scope, params, actor, [sales.id]);
      assert.ok(before.sources[0].history.coveredMilliseconds! > 0);
      const pending = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: source.id, status: "RETRY_WAIT" } });
      await prisma.amazonSyncRun.update({ where: { id: pending.id }, data: { nextAttemptAt: new Date(0) } });
      await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: completed.authorizationId }, data: { nextRequestAt: new Date(0) } });
      await processSyncCenterTask(pending.id, pending.dispatchVersion);
      const checkpointed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: pending.id } });
      assert.equal(checkpointed.pagesCompleted, 1);
      const pausedSource = sources.find(s => s.resource === "orders" && s.marketplaceId === site)!;
      const paused = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: pausedSource.id } });
      await prisma.amazonSyncRun.update({ where: { id: paused.id }, data: { status: "PAUSED" } });
      const cancelledSource = sources.find(s => s.resource === "returns" && s.marketplaceId === site)!;
      const cancelled = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: cancelledSource.id } });
      await prisma.amazonSyncRun.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
      const disabledSource = sources.find(s => s.resource === "catalog" && s.marketplaceId === site)!;
      const disabled = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: disabledSource.id } });
      await prisma.amazonSyncSchedule.update({ where: { id: disabled.scheduleId! }, data: { enabled: false } });
      const changedSource = sources.find(s => s.resource === "catalog" && s.marketplaceId === secondSite)!;
      const changed = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: changedSource.id } });
      await prisma.amazonSyncDataSource.update({ where: { id: changedSource.id }, data: { revision: { increment: 1 } } });
      const manual = await prisma.amazonSyncRun.create({ data: { ...scope, id: randomUUID(), sourceId: source.id, resource: "inventory", requestedByUserId: actor,
        executionVersion: 2, status: "FAILED", authorizationRevision: original.authorizationRevision, trigger: "manual",
        frozenScope: checkpointed.frozenScope as Prisma.InputJsonValue, frozenScopeDigest: checkpointed.frozenScopeDigest, summary: { quality: { code: "AUTH" } } } });
      const interruptedSource = sources.find(s => s.resource === "inventory" && s.marketplaceId === secondSite)!;
      const interrupted = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: interruptedSource.id } });
      await prisma.amazonSyncRun.update({ where: { id: interrupted.id }, data: { status: "FAILED", attempts: interrupted.maxAttempts,
        finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, summary: { quality: { code: "WORKER_INTERRUPTED" } } } });
      const renewed = await startAmazonOAuth(scope, actor, "us-east-1");
      const result = await finishAmazonOAuth(actor, new URLSearchParams({ state: new URL(renewed.consentUrl).searchParams.get("state")!, selling_partner_id: "AUTOFIXTURE1", spapi_oauth_code: "fixture-renewal-code" }));
      assert.equal(result.authorizationId, completed.authorizationId);
      const rebound = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: checkpointed.id } });
      assert.equal(rebound.authorizationRevision, original.authorizationRevision! + 1);
      assert.equal(rebound.checkpointCiphertext, checkpointed.checkpointCiphertext);
      assert.equal(rebound.pagesCompleted, 1);
      assert.equal(rebound.attempts, checkpointed.attempts);
      const resumedInterrupted = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: interrupted.id } });
      assert.equal(resumedInterrupted.authorizationRevision, rebound.authorizationRevision);
      assert.equal(resumedInterrupted.status, "WAITING");
      assert.equal(resumedInterrupted.attempts, interrupted.maxAttempts);
      assert.ok(resumedInterrupted.maxAttempts > resumedInterrupted.attempts);
      assert.equal(resumedInterrupted.dispatchVersion, interrupted.dispatchVersion + 1);
      const bindingAudit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: scope.organizationId, entityId: rebound.id, action: "amazon.sync.authorization.task-rebound" } });
      assert.equal((bindingAudit.metadata as { previousFrozenScopeDigest: string }).previousFrozenScopeDigest, checkpointed.frozenScopeDigest);
      const fencedCalls = calls.length;
      await processSyncCenterTask(checkpointed.id, checkpointed.dispatchVersion);
      assert.equal(calls.length, fencedCalls);
      await prisma.amazonSyncRun.update({ where: { id: rebound.id }, data: { nextAttemptAt: new Date(0) } });
      await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: completed.authorizationId }, data: { nextRequestAt: new Date(0) } });
      const resumedCalls = calls.length;
      await processSyncCenterTask(rebound.id, rebound.dispatchVersion);
      assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: rebound.id } })).status, "SUCCEEDED");
      assert.deepEqual(calls.slice(resumedCalls).filter(c => c.includes("/fba/inventory/")), [calls.slice(resumedCalls).find(c => c.includes("nextToken=fixture-next"))]);
      assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: rebound.id, page: { gt: 0 } } }), 2);
      assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: rebound.id } }), 2);
      assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: paused.id } })).status, "PAUSED");
      assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: cancelled.id } })).status, "CANCELLED");
      for (const untouchedId of [disabled.id, changed.id, manual.id]) assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: untouchedId } })).authorizationRevision, original.authorizationRevision);
      const rebindCount = await prisma.auditLog.count({ where: { organizationId: scope.organizationId, action: "amazon.sync.authorization.task-rebound" } });
      await ensureAmazonSyncInitialized(scope, completed.authorizationId);
      assert.equal(await prisma.auditLog.count({ where: { organizationId: scope.organizationId, action: "amazon.sync.authorization.task-rebound" } }), rebindCount);
      const current = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sales.id }, include: { authorization: true, resourceCursor: true } });
      assert.equal(current.authorization.revision, original.authorizationRevision! + 1);
      const plan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { targets: { some: { sourceId: sales.id } } } });
      const now = new Date(), expected = nextSalesTrafficRange(site, now, [requestedRange]);
      // Seed adversarial history identities in the same disposable source.
      const mismatches = [{ amazonSellerId: "OTHERSELLER" }, { sellerAccountId: randomUUID() }, { marketplaceId: secondSite },
        { sourceRevision: sales.revision + 1 }, { authorizationId: randomUUID() }, { authorizationRevision: current.authorization.revision + 1 },
        { authorizationRevision: current.authorization.revision, sourceRevision: sales.revision + 1 },
        { authorizationRevision: current.authorization.revision, amazonSellerId: "OTHERSELLER" }];
      await prisma.amazonSyncRun.createMany({ data: mismatches.map(patch => {
        const invalid = { ...frozen, ...patch, requestedRange: expected.range };
        return { ...scope, id: randomUUID(), resource: "sales_traffic", sourceId: sales.id, requestedByUserId: actor, executionVersion: 2, mode: "date_range",
          status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true, finishedAt: new Date(), frozenScope: invalid as Prisma.InputJsonObject,
          frozenScopeDigest: digest(invalid), summary: { coverage: { complete: true } } };
      }) });
      const planned = await planAutomaticTask(automaticAdapters.find(a => a.resource === "sales_traffic")!, scope, current, plan, now);
      assert.deepEqual(planned?.payload.requestedRange, expected.range, "renewal must skip completed history and reject mismatched identities");
      const unverified = await planAutomaticTask(automaticAdapters.find(a => a.resource === "sales_traffic")!, scope,
        { ...current, authorization: { ...current.authorization, identityVerifiedAt: null } }, plan, now);
      assert.deepEqual(unverified?.payload.requestedRange, nextSalesTrafficRange(site, now, []).range, "unverified identities cannot inherit old credential coverage");
      const after = await readSyncCoverage(scope, params, actor, [sales.id]);
      assert.equal(after.sources[0].history.coveredMilliseconds, before.sources[0].history.coveredMilliseconds);
      await prisma.$transaction(tx => persistWindowCheckpoints(tx, history, now));
      const measured = await readSyncCoverage(scope, params, actor, [sales.id]);
      assert.equal(measured.sources[0].windowCheckpoints?.current, true);
      assert.ok(measured.sources[0].windowCheckpoints?.lastCompleteWindow);
      const untouched = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: history.id } });
      assert.equal(untouched.frozenScopeDigest, original.frozenScopeDigest);
      assert.equal(untouched.authorizationRevision, original.authorizationRevision);
      const previousCalls = calls.length;
      await processSyncCenterTask(original.id, original.dispatchVersion);
      assert.equal(calls.length, previousCalls, "old execution authority must still be rejected after OAuth renewal");
    });
    await t.test("Finance internal history gaps replay through the Worker without rewinding the forward cursor", async () => {
      const finance = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "finance" }, include: { authorization: true } });
      const plan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { targets: { some: { sourceId: finance.id } } } });
      await prisma.amazonSyncRun.updateMany({ where: { sourceId: finance.id, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT", "BLOCKED"] } }, data: { status: "CANCELLED" } });
      const policy = parseFinancePolicy(finance.financePolicy), policyDigest = digest(policy), now = new Date(), cursorTo = new Date(now.getTime() - 4 * 86400000);
      const gapFrom = new Date(cursorTo.getTime() - 45 * 86400000), gapTo = new Date(gapFrom.getTime() + 2 * 86400000);
      const baseFrozen = { sourceId: finance.id, sourceRevision: finance.revision, authorizationId: finance.authorizationId, authorizationRevision: finance.authorization.revision,
        amazonSellerId: finance.authorization.amazonSellerId, sellerAccountId: finance.sellerAccountId, marketplaceId: finance.marketplaceId, resource: "finance" };
      let evidenceRunId = "";
      const seedCoverage = async (start: Date, end: Date) => {
        let from = start;
        while (from < end) {
          const to = new Date(Math.min(end.getTime(), from.getTime() + 30 * 86400000)), id = randomUUID();
          const window = { from: from.toISOString(), to: to.toISOString() }, frozen = { ...baseFrozen, financeWindow: window, financePolicy: policy };
          await prisma.amazonSyncRun.create({ data: { ...scope, id, idempotencyKey: `finance-history-evidence:${randomUUID()}`, sourceId: finance.id, requestedByUserId: actor,
            resource: "finance", mode: "incremental", trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, authorizationRevision: finance.authorization.revision,
            executionVersion: 2, status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true, finishedAt: now, frozenScope: frozen, frozenScopeDigest: digest(frozen),
            summary: { coverage: { transportComplete: true, quarantinedCount: 0 } } } });
          evidenceRunId = id; from = to;
        }
      };
      const initial = new Date(policy.initialFrom);
      await seedCoverage(initial, gapFrom);
      await seedCoverage(gapTo, cursorTo);
      await prisma.amazonSyncResourceCursor.upsert({ where: { sourceId: finance.id }, create: { ...scope, id: randomUUID(), sourceId: finance.id, resource: "finance",
        amazonSellerId: finance.authorization.amazonSellerId!, marketplaceId: finance.marketplaceId, watermarkFrom: initial, watermarkTo: cursorTo, activeRunId: evidenceRunId,
        status: "SUCCEEDED", detailPolicyDigest: policyDigest, nextTokenCiphertext: null, captureSequence: 10 }, update: { watermarkFrom: initial, watermarkTo: cursorTo,
        activeRunId: evidenceRunId, status: "SUCCEEDED", detailPolicyDigest: policyDigest, nextTokenCiphertext: null, captureSequence: 10 } });
      const originalCursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: finance.id } });
      await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { nextRunAt: now } });
      await enqueueDueAutomaticPlans([scope], now, [finance.id]);
      const replay = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: finance.id, status: { in: ["WAITING", "QUEUED"] }, trigger: "schedule" }, orderBy: { startedAt: "desc" } });
      const frozen = replay.frozenScope as { financeWindow: { from: string; to: string }; financeHistoryReplay?: boolean };
      assert.equal(frozen.financeHistoryReplay, true);
      assert.deepEqual(frozen.financeWindow, { from: gapFrom.toISOString(), to: gapTo.toISOString() });
      const financeBefore = financeRequests.length;
      await processSyncCenterTask(replay.id, replay.dispatchVersion, { clientOptions: { fetch: globalThis.fetch, tokenEndpoint: "https://lwa.fixture.invalid/token" } });
      const completed = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: replay.id } });
      const financeLogs = await prisma.amazonSyncTaskLog.findMany({ where: { ...scope, taskId: replay.id }, select: { event: true, stage: true, statusCode: true, code: true } });
      assert.equal(completed.status, "SUCCEEDED", JSON.stringify({ error: completed.error, summary: completed.summary, financeLogs, financeRequests, calls: calls.slice(-8) }));
      assert.equal(financeRequests.length, financeBefore + 1);
      assert.deepEqual(financeRequests.at(-1), { postedAfter: gapFrom.toISOString(), postedBefore: gapTo.toISOString() });
      const advancedCursor = await prisma.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: finance.id } });
      assert.equal(advancedCursor.watermarkFrom.getTime(), originalCursor.watermarkFrom.getTime());
      assert.equal(advancedCursor.watermarkTo.getTime(), originalCursor.watermarkTo.getTime());
      assert.equal(advancedCursor.activeRunId, originalCursor.activeRunId);
      assert.equal(advancedCursor.nextTokenCiphertext, originalCursor.nextTokenCiphertext);
      assert.equal(advancedCursor.status, "SUCCEEDED");
      assert.equal(advancedCursor.captureSequence, originalCursor.captureSequence + 1);
      assert.equal(await prisma.amazonFinanceRecord.count({ where: { ...scope, sourceId: finance.id, transactionId: "fixture-history-replay" } }), 1);

      const later = new Date(now.getTime() + 2 * 60000);
      await enqueueDueAutomaticPlans([scope], later, [finance.id]);
      const incremental = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: finance.id, status: { in: ["WAITING", "QUEUED"] }, trigger: "schedule", id: { not: replay.id } }, orderBy: { startedAt: "desc" } });
      const nextFrozen = incremental.frozenScope as { financeWindow: { from: string; to: string }; financeHistoryReplay?: boolean };
      assert.notEqual(nextFrozen.financeHistoryReplay, true);
      assert.equal(Date.parse(nextFrozen.financeWindow.from), originalCursor.watermarkTo.getTime() - policy.overlapSeconds * 1000);
      await prisma.amazonSyncRun.updateMany({ where: { id: incremental.id, status: { in: ["WAITING", "QUEUED"] } }, data: { status: "CANCELLED" } });
    });

    await t.test("sales coverage holes collect only missing dates then cadence refresh publishes from the same automatic plan", async () => {
      const sales = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "sales_traffic", marketplaceId: site }, include: { authorization: true } });
      const plan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { targets: { some: { sourceId: sales.id } } } });
      const template = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: sales.id } });
      await prisma.amazonSyncRun.updateMany({ where: { sourceId: sales.id, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT", "BLOCKED"] } }, data: { status: "CANCELLED" } });
      const at = new Date(new Date().toISOString().slice(0, 10) + "T23:59:00Z");
      const today = localDate(at, reportTimeZone(site)), initial = shiftDate(today, -730), yesterday = shiftDate(today, -1), gap = shiftDate(today, -50);
      // Historical coverage is synthetic fixture evidence; collection below
      // executes the actual report/archive/parse/publication pipeline.
      for (const range of [{ from: initial, to: shiftDate(gap, -1) }, { from: shiftDate(gap, 1), to: yesterday }]) {
        const frozen = { ...(template.frozenScope as Prisma.JsonObject), authorizationRevision: sales.authorization.revision, requestedRange: range };
        await prisma.amazonSyncRun.create({ data: { ...scope, id: randomUUID(), sourceId: sales.id, requestedByUserId: actor, resource: "sales_traffic", mode: "date_range", executionVersion: 2, status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true, finishedAt: new Date(), authorizationRevision: sales.authorization.revision, frozenScope: frozen, frozenScopeDigest: digest(frozen), summary: { coverage: { complete: true } } } });
      }
      const duplicateRange = { from: yesterday, to: yesterday };
      const duplicateFrozen = { ...(template.frozenScope as Prisma.JsonObject), authorizationRevision: sales.authorization.revision, requestedRange: duplicateRange };
      await prisma.amazonSyncRun.createMany({ data: Array.from({ length: 1005 }, () => ({ ...scope, id: randomUUID(), sourceId: sales.id, requestedByUserId: actor,
        resource: "sales_traffic", mode: "date_range", executionVersion: 2, status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true,
        finishedAt: new Date(), authorizationRevision: sales.authorization.revision, frozenScope: duplicateFrozen, frozenScopeDigest: digest(duplicateFrozen), summary: { coverage: { complete: true } } })) });
      assert.deepEqual(await readSalesHistoryCoverage(scope, sales, at), [
        { from: initial, to: shiftDate(gap, -1) }, { from: shiftDate(gap, 1), to: yesterday },
      ], "more than 1000 recent refreshes must not hide older complete intervals or the real gap");
      // Wrong tenant, Seller and malformed credential revisions cannot fill it.
      const badBindings = [{ amazonSellerId: "FOREIGNSELLER" }, { sellerAccountId: randomUUID() }, { marketplaceId: secondSite },
        { authorizationRevision: 0.5 }, { authorizationRevision: String(sales.authorization.revision) }];
      await prisma.amazonSyncRun.createMany({ data: badBindings.map(binding => {
        const frozen = { ...duplicateFrozen, requestedRange: { from: gap, to: gap }, ...binding };
        return { ...scope, id: randomUUID(), sourceId: sales.id, requestedByUserId: actor, resource: "sales_traffic", mode: "date_range", executionVersion: 2,
          status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true, finishedAt: new Date(), authorizationRevision: sales.authorization.revision,
          frozenScope: frozen, frozenScopeDigest: digest(frozen), summary: { coverage: { complete: true } } };
      }) });
      assert.equal((await readSalesHistoryCoverage(scope, sales, at)).length, 2);
      assert.deepEqual(await readSalesHistoryCoverage({ ...scope, workspaceId: "foreign" }, sales, at), []);
      const collected: Array<{ dataStartTime: string; dataEndTime: string; reportOptions: unknown; reportType: string; marketplaceIds: string[] }> = [];
      const baseFetch = globalThis.fetch;
      let reportHttpCalls = 0, reportUnits = 1;
      globalThis.fetch = async (input, init) => {
        reportHttpCalls++;
        const url = new URL(String(input));
        if (url.pathname === "/reports/2021-06-30/reports" && init?.method === "POST") {
          collected.push(JSON.parse(String(init.body)));
          return Response.json({ reportId: `fixture-sales-${collected.length}` });
        }
        if (url.pathname.startsWith("/reports/2021-06-30/reports/")) return Response.json({ reportId: url.pathname.split("/").at(-1), reportType: "GET_SALES_AND_TRAFFIC_REPORT", marketplaceIds: [site], processingStatus: "DONE", reportDocumentId: "fixture-sales-document" });
        if (url.pathname.startsWith("/reports/2021-06-30/documents/")) return Response.json({ reportDocumentId: "fixture-sales-document", url: "https://fixture.s3.amazonaws.com/sales" });
        if (url.hostname === "fixture.s3.amazonaws.com") {
          const spec = collected.at(-1)!;
          const rows = [];
          for (let date = spec.dataStartTime.slice(0, 10); date <= spec.dataEndTime.slice(0, 10); date = shiftDate(date, 1)) rows.push({ date, salesByDate: { unitsOrdered: reportUnits, totalOrderItems: 1, orderedProductSales: { amount: 2, currencyCode: "USD" } }, trafficByDate: { sessions: 1, pageViews: 1 } });
          return Response.json({ reportSpecification: spec, salesAndTrafficByDate: rows });
        }
        return baseFetch(input, init);
      };
      const schedule = async (when: Date) => {
        await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { nextRunAt: when } });
        await enqueueDueAutomaticPlans([scope], when, [sales.id]);
      };
      const complete = async (interruptPublication = false) => {
        const expectInterruption = interruptPublication;
        let task = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: sales.id, status: "WAITING" } });
        let replayHttpCount: number | undefined, interrupted = false;
        if (interruptPublication) {
          await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_reject_sales_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."activeRunId" IS DISTINCT FROM OLD."activeRunId" THEN RAISE EXCEPTION 'fixture sales publication interruption' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`);
          await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_reject_sales_publication BEFORE UPDATE ON "AmazonSyncDataSource" FOR EACH ROW EXECUTE FUNCTION fixture_reject_sales_publication()`);
        }
        try {
          for (let i = 0; i < 6 && ["WAITING", "RETRY_WAIT"].includes(task.status); i++) {
            await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { nextAttemptAt: new Date(0) } });
            await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: sales.authorizationId }, data: { nextRequestAt: new Date(0) } });
            await processSyncCenterTask(task.id, task.dispatchVersion);
            task = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
            if (interruptPublication && task.status === "RETRY_WAIT") {
              assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: task.id, page: { gt: 0 } } }), 1);
              assert.equal(await prisma.amazonSalesTrafficSnapshot.count({ where: { syncRunId: task.id } }), 0, "failed publication transaction must not leak staged rows");
              assert.notEqual((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sales.id } })).activeRunId, task.id);
              await prisma.$executeRawUnsafe(`DROP TRIGGER fixture_reject_sales_publication ON "AmazonSyncDataSource"`);
              await prisma.$executeRawUnsafe(`DROP FUNCTION fixture_reject_sales_publication()`);
              interruptPublication = false; interrupted = true; replayHttpCount = reportHttpCalls;
            }
          }
        } finally {
          if (interruptPublication) {
            await prisma.$executeRawUnsafe(`DROP TRIGGER fixture_reject_sales_publication ON "AmazonSyncDataSource"`);
            await prisma.$executeRawUnsafe(`DROP FUNCTION fixture_reject_sales_publication()`);
          }
        }
        if (replayHttpCount !== undefined) assert.equal(reportHttpCalls, replayHttpCount, "report publication retry must reuse the archived report with zero HTTP");
        if (expectInterruption) assert.equal(interrupted, true, "SQL publication fault must actually be exercised");
        if (interrupted) assert.equal((task.summary as { coverage?: { complete?: boolean } }).coverage?.complete, true);
        assert.equal(task.status, "SUCCEEDED", task.error ?? "");
        assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: task.id, page: { gt: 0 } } }), 1);
        assert.equal(await prisma.amazonSalesTrafficSnapshot.count({ where: { syncRunId: task.id } }), Math.round((Date.parse(collected.at(-1)!.dataEndTime.slice(0, 10)) - Date.parse(collected.at(-1)!.dataStartTime.slice(0, 10))) / 86400000) + 1);
        return task;
      };
      try {
        await schedule(at);
        const repaired = await complete(true);
        assert.equal(collected.length, 1);
        assert.equal(collected[0].dataStartTime.slice(0, 10), gap);
        assert.equal(collected[0].dataEndTime.slice(0, 10), gap);
        await schedule(at);
        const refreshed = await complete();
        assert.notEqual(refreshed.id, repaired.id);
        assert.equal(collected.length, 2);
        assert.equal(collected[1].dataStartTime.slice(0, 10), shiftDate(yesterday, -6));
        assert.equal(collected[1].dataEndTime.slice(0, 10), yesterday);
        await schedule(at);
        assert.equal(collected.length, 2);
        assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: sales.id, status: "WAITING" } }), 0);
        const nextCadence = new Date(at.getTime() + 2 * 60000);
        assert.equal(localDate(nextCadence, reportTimeZone(site)), today);
        await schedule(nextCadence);
        const later = await complete();
        assert.notEqual(later.id, refreshed.id);
        assert.equal(collected.length, 3);
        assert.equal(collected[2].dataStartTime, collected[1].dataStartTime);
        assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sales.id } })).activeRunId, later.id);
        const createWindow = (from: string, to: string) => prisma.$transaction(tx => createTask(tx, scope, actor, sales.id, {
          key: `fixture-window-order-${randomUUID()}`, trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision,
          requestedRange: resolveRequestedRange(site, { datePreset: "custom", dateFrom: from, dateTo: to }, at),
        }));
        const older = await createWindow(shiftDate(yesterday, -1), yesterday);
        let waitingOld = older;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_defer_old_window() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."activeRunId" IS DISTINCT FROM OLD."activeRunId" THEN RAISE EXCEPTION 'fixture delayed old window' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_defer_old_window BEFORE UPDATE ON "AmazonSyncDataSource" FOR EACH ROW EXECUTE FUNCTION fixture_defer_old_window()`);
        try {
          for (let i = 0; i < 5 && waitingOld.status === "WAITING"; i++) {
            await prisma.amazonSyncRun.update({ where: { id: older.id }, data: { nextAttemptAt: new Date(0) } });
            await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: sales.authorizationId }, data: { nextRequestAt: new Date(0) } });
            await processSyncCenterTask(older.id, waitingOld.dispatchVersion);
            waitingOld = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: older.id } });
          }
          assert.equal(waitingOld.status, "RETRY_WAIT");
          assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: older.id } }), 1);
          assert.equal(await prisma.amazonSalesTrafficSnapshot.count({ where: { syncRunId: older.id } }), 0);
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER fixture_defer_old_window ON "AmazonSyncDataSource"`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION fixture_defer_old_window()`);
        }
        // Cancel only the disposable fixture task to permit a newer collection,
        // then emulate recovery of the older archived request after publication.
        await prisma.amazonSyncRun.update({ where: { id: older.id }, data: { status: "CANCELLED" } });
        reportUnits = 9;
        const newer = await createWindow(yesterday, yesterday);
        await complete();
        assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sales.id } })).activeRunId, newer.id);
        const beforeReplay = reportHttpCalls;
        const resumed = await prisma.amazonSyncRun.update({ where: { id: older.id }, data: { status: "WAITING", finishedAt: null, nextAttemptAt: new Date(0), dispatchVersion: { increment: 1 } } });
        await processSyncCenterTask(older.id, resumed.dispatchVersion);
        const recovered = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: older.id } });
        assert.equal(recovered.status, "SUCCEEDED", recovered.error ?? "");
        assert.equal(reportHttpCalls, beforeReplay, "late window recovery must not redownload the report");
        assert.equal((recovered.summary as { publication: { headAdvanced: boolean } }).publication.headAdvanced, false);
        assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: sales.id } })).activeRunId, newer.id);
        // Emulate an older parser that stamped rows at replay time. Immutable
        // archive time must still determine the winning overlapping version.
        await prisma.amazonSalesTrafficSnapshot.updateMany({ where: { syncRunId: older.id }, data: { capturedAt: new Date(Date.now() + 86400000) } });
        const query = new URLSearchParams({ sellerAccountId, marketplaceId: site, from: shiftDate(yesterday, -1), to: yesterday, direction: "asc" });
        const result = await readSalesTraffic(scope, query, { actor });
        assert.deepEqual(result.rows.map(r => [r.businessDate, r.metrics.unitsOrdered, r.syncRunId]), [[shiftDate(yesterday, -1), "1", older.id], [yesterday, "9", newer.id]], "late old report fills its exclusive day without replacing the newer overlapping day");
        const historical = await readSalesTraffic(scope, new URLSearchParams({ ...Object.fromEntries(query), taskId: older.id }), { actor });
        assert.equal(historical.rows.length, 2, "the old report remains explicitly queryable as historical evidence");
        const session = await createSession(actor);
        const erpParams = new URLSearchParams({ ...Object.fromEntries(query), workspaceId: scope.workspaceId, section: "sales-traffic" });
        const erpResponse = await erpRead(new Request(`http://fixture/api/operations/sync-center?${erpParams}`, { headers: { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }));
        assert.equal(erpResponse.status, 200);
        const erp = await erpResponse.json();
        const principal = await authenticateAmazonMcp(`Bearer amcp_${"a".repeat(43)}`);
        const mcp = await invokeAmazonMcp(principal, "amazon.sales.list", { sellerAccountId, marketplaceId: site, from: shiftDate(yesterday, -1), to: yesterday }) as { rows: Array<{ businessDate: string; metrics: { unitsOrdered?: string | null }; syncRunId: string }> };
        const versions = (rows: typeof mcp.rows) => rows.map(r => [r.businessDate, r.metrics.unitsOrdered, r.syncRunId]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        assert.deepEqual(versions(erp.rows), versions(mcp.rows));
        assert.deepEqual(versions(mcp.rows), versions(result.rows));


      } finally { globalThis.fetch = baseFetch; }
    });
    await t.test("date-report adapters repair internal history holes through the existing worker and publication path", async () => {
      for (const resource of ["inventory_events", "reimbursements"] as const) {
        const current = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource, marketplaceId: site }, include: { authorization: true } });
        const adapter = automaticAdapter(resource)!, config = adapter.dayWindows!;
        const plan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { targets: { some: { sourceId: current.id } } } });
        const at = new Date(), today = at.toISOString().slice(0, 10), yesterday = shiftDate(today, -1), gap = shiftDate(today, -45);
        await prisma.amazonSyncRun.updateMany({ where: { sourceId: current.id, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT", "BLOCKED"] } }, data: { status: "CANCELLED" } });
        const template = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: current.id } });
        const frozenBase = { ...template.frozenScope as Prisma.JsonObject, sourceRevision: current.revision, authorizationRevision: current.authorization.revision };
        const wholeWindow = (from: string, to: string) => ({ from, to, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${to}T23:59:59Z`, ...(resource === "inventory_events" ? { eventType: "" } : {}) });
        const seed = async (window: Record<string, string>, overrides: Prisma.JsonObject = {}, coverage: Prisma.JsonObject = { complete: true, transportComplete: true, attributionComplete: true }) => {
          const frozen = { ...frozenBase, reportWindow: window, ...overrides };
          return prisma.amazonSyncRun.create({ data: { ...scope, id: randomUUID(), sourceId: current.id, requestedByUserId: actor, resource, mode: "report", executionVersion: 2,
            status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true, finishedAt: at, authorizationRevision: current.authorization.revision,
            frozenScope: frozen, frozenScopeDigest: digest(frozen), summary: { coverage } } });
        };
        await seed(wholeWindow(shiftDate(today, -config.historyDays), shiftDate(gap, -1)));
        const last = await seed(wholeWindow(shiftDate(gap, 1), yesterday));
        // These records must never close the real hole or crash the repository.
        await seed(wholeWindow(gap, gap), {}, { complete: true, transportComplete: true, attributionComplete: false });
        await seed(wholeWindow(gap, gap), { sellerAccountId: randomUUID() });
        await seed(wholeWindow("2026-02-30", "2026-99-99"));
        if (resource === "inventory_events") await seed({ ...wholeWindow(gap, gap), eventType: "Receipts" });
        const cursor = { ...scope, sourceId: current.id, resource, amazonSellerId: current.authorization.amazonSellerId, marketplaceId: site,
          watermarkFrom: new Date(`${yesterday}T00:00:00Z`), watermarkTo: new Date(`${yesterday}T23:59:59Z`), activeRunId: last.id, status: "SUCCEEDED" };
        await prisma.amazonSyncResourceCursor.upsert({ where: { sourceId: current.id }, create: { id: randomUUID(), ...cursor }, update: { ...cursor, reportStateCiphertext: null } });
        const before = await readAutomaticDayHistory(scope, current, today, config);
        assert.deepEqual(before, [{ from: shiftDate(today, -config.historyDays), to: shiftDate(gap, -1) }, { from: shiftDate(gap, 1), to: yesterday }]);
        const baseFetch = globalThis.fetch, requested: Array<{ dataStartTime: string; dataEndTime: string }> = [];
        const reportId = `fixture-gap-${resource}`, documentId = `fixture-gap-document-${resource}`;
        globalThis.fetch = async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === "/reports/2021-06-30/reports" && init?.method === "POST") { requested.push(JSON.parse(String(init.body))); return Response.json({ reportId }); }
          if (url.pathname === `/reports/2021-06-30/reports/${reportId}`) return Response.json({ reportId, reportType: domainReportTypes[resource], marketplaceIds: [site], processingStatus: "DONE", reportDocumentId: documentId, ...requested.at(-1) });
          if (url.pathname === `/reports/2021-06-30/documents/${documentId}`) return Response.json({ reportDocumentId: documentId, url: `https://fixture.s3.amazonaws.com/${documentId}` });
          if (url.hostname === "fixture.s3.amazonaws.com" && url.pathname === `/${documentId}`) return new Response(resource === "inventory_events"
            ? `date\tevent-type\tquantity\tfnsku\tmarketplace-id\n${gap}\tReceipts\t1\tFIXTURE-FNSKU\t${site}\n`
            : `approval-date\treimbursement-id\tamount-total\tcurrency-unit\tmarketplace-id\n${gap}\tFIXTURE-REIMBURSEMENT\t1.00\tUSD\t${site}\n`);
          return baseFetch(input, init);
        };
        try {
          await prisma.amazonSyncSchedule.update({ where: { id: plan.id }, data: { nextRunAt: at } });
          await enqueueDueAutomaticPlans([scope], at, [current.id]);
          await enqueueDueAutomaticPlans([scope], at, [current.id]);
          let task = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: current.id, trigger: "schedule", status: "WAITING" } });
          assert.equal((task.frozenScope as { reportWindow: { from: string } }).reportWindow.from, gap);
          for (let i = 0; i < 10 && ["WAITING", "RETRY_WAIT"].includes(task.status); i++) {
            await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { nextAttemptAt: new Date(0) } });
            await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: current.authorizationId }, data: { nextRequestAt: new Date(0) } });
            await processSyncCenterTask(task.id, task.dispatchVersion);
            task = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
          }
          assert.equal(task.status, "SUCCEEDED", task.error ?? "");
          assert.equal(requested.length, 1);
          assert.deepEqual([requested[0].dataStartTime.slice(0, 10), requested[0].dataEndTime.slice(0, 10)], [gap, gap]);
          assert.equal(await prisma.amazonSyncReportDocument.count({ where: { sourceRunId: task.id, status: "PUBLISHED" } }), 1);
          assert.equal(await prisma.amazonSyncReportRow.count({ where: { sourceId: current.id, document: { sourceRunId: task.id } } }), 1);
          assert.deepEqual(await readAutomaticDayHistory(scope, current, today, config), [{ from: shiftDate(today, -config.historyDays), to: yesterday }]);
          const requestsBeforeReplay = requested.length;
          await processSyncCenterTask(task.id, task.dispatchVersion);
          assert.equal(requested.length, requestsBeforeReplay);
        } finally { globalThis.fetch = baseFetch; }
      }
    });
    await t.test("requeued archived snapshot cannot overwrite a newer publication or request another page", async () => {
      const plan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { targets: { some: { sourceId: source.id } }, planKey: `auto-v1:${source.id}` } });
      const create = () => prisma.$transaction(tx => createTask(tx, scope, actor, source.id, { key: `fixture-head-${randomUUID()}`, trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts }));
      const advance = async (taskId: string) => {
        const task = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: taskId } });
        await prisma.amazonSyncRun.update({ where: { id: task.id }, data: { nextAttemptAt: new Date(0) } });
        await prisma.amazonSyncApiBudget.updateMany({ where: { ...scope, authorizationId: completed.authorizationId }, data: { nextRequestAt: new Date(0) } });
        await processSyncCenterTask(task.id, task.dispatchVersion);
        return prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: task.id } });
      };
      const older = await create();
      const archived = await advance(older.id);
      assert.equal(archived.pagesCompleted, 1);
      assert.equal(archived.status, "WAITING");
      const originalRaw = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { taskId: older.id } });
      await prisma.amazonSyncRun.update({ where: { id: older.id }, data: { status: "CANCELLED" } });
      const newer = await create();
      assert.ok(newer.startedAt > older.startedAt);
      assert.equal((await advance(newer.id)).status, "WAITING");
      assert.equal((await advance(newer.id)).status, "SUCCEEDED");
      const published = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } });
      assert.equal(published.activeRunId, newer.id);
      const requeued = await prisma.amazonSyncRun.update({ where: { id: older.id }, data: { status: "WAITING", nextAttemptAt: new Date(0), control: null, dispatchVersion: { increment: 1 } } });
      const beforeCalls = calls.length;
      await processSyncCenterTask(older.id, requeued.dispatchVersion);
      const stopped = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: older.id } });
      assert.equal(stopped.status, "BLOCKED");
      assert.match(stopped.error!, /较新发布版本/);
      assert.equal(stopped.checkpointCiphertext, archived.checkpointCiphertext);
      assert.equal(stopped.pagesCompleted, 1);
      assert.equal(stopped.attempts, archived.attempts, "superseded task must be stopped before starting another attempt");
      assert.equal(calls.length, beforeCalls);
      assert.equal((await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: originalRaw.taskId, page: originalRaw.page } } })).bodySha256, originalRaw.bodySha256);
      assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: older.id } }), 1);
      const after = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } });
      assert.equal(after.activeRunId, newer.id);
      assert.deepEqual(after.coverage, published.coverage);
      const following = await create();
      assert.equal((await advance(following.id)).pagesCompleted, 1, "a later legitimate refresh must still execute");
      await prisma.amazonSyncRun.update({ where: { id: following.id }, data: { status: "CANCELLED" } });
    });
    await t.test("capacity preserves partial discovery and automatically completes missing adapters when space is available", async () => {
      const target = { organizationId: randomUUID(), workspaceId: "default" }, authId = randomUUID();
      await prisma.organization.create({ data: { id: target.organizationId, slug: target.organizationId, name: "Capacity fixture" } });
      await prisma.workspaceScope.create({ data: { organizationId: target.organizationId, id: target.workspaceId, name: "Fixture" } });
      await prisma.user.update({ where: { id: actor }, data: { memberships: { create: { organizationId: target.organizationId, role: "owner" } } } });
      const auth = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: completed.authorizationId } });
      await prisma.amazonSpApiAuthorization.create({ data: { ...target, id: authId, name: "Capacity fixture", updatedByUserId: actor,
        awsRegion: auth.awsRegion, endpoint: auth.endpoint, approvedRoles: auth.approvedRoles, rolesAttestedAt: auth.rolesAttestedAt, status: "CONFIGURED", amazonSellerId: "CAPACITYFIXTURE", identityVerifiedAt: new Date(), lastValidatedAt: new Date(),
        marketplaceParticipations: [{ marketplaceId: site }], credentialsCiphertext: encryptAmazonSpApiCredentials({ lwaClientId: "fixture-capacity", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "" }, { ...target, authorizationId: authId }) } });
      const fillerAuthId = randomUUID();
      await prisma.amazonSpApiAuthorization.create({ data: { ...target, id: fillerAuthId, name: "Disabled capacity fixture", amazonSellerId: "DISABLEDFIXTURE", updatedByUserId: actor, awsRegion: auth.awsRegion, endpoint: auth.endpoint, status: "DISABLED", credentialsCiphertext: "not-a-credential" } });
      const accounts = Array.from({ length: 199 }, () => randomUUID());
      const fillers = accounts.map(() => randomUUID());
      await prisma.sellerAccount.createMany({ data: accounts.map(id => ({ ...target, id, accountKey: id, displayName: "Capacity filler", marketplaceCode: "US" })) });
      // Disabled filler sources stay inside this fixture tenant and never execute.
      await prisma.amazonSyncDataSource.createMany({ data: fillers.map((id, i) => ({ ...target, id, authorizationId: fillerAuthId, sellerAccountId: accounts[i], marketplaceId: site, resource: "inventory", enabled: false, freshnessMinutes: 360 })) });
      const beforeCalls = calls.length;
      await ensureAutomaticConnections([target], new Date(), authId);
      const discovered = await prisma.amazonSyncDataSource.findMany({ where: { ...target, authorizationId: authId } });
      assert.equal(discovered.length, 1, "the first valid adapter must commit instead of rolling back at capacity");
      assert.equal(await prisma.amazonSyncDataSource.count({ where: target }), 200);
      const audits = () => prisma.auditLog.count({ where: { organizationId: target.organizationId, entityId: authId, action: "amazon.sync.connection.capacity-deferred" } });
      assert.equal(await audits(), 1);
      await ensureAutomaticConnections([target], new Date(), authId);
      assert.equal(await audits(), 1, "unchanged capacity must not create audit spam");
      await prisma.amazonSyncDataSource.deleteMany({ where: { ...target, id: { in: fillers } } });
      const configuredScopes = process.env.AMAZON_SYNC_CENTER_SCOPES;
      process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId], [target.organizationId, target.workspaceId]]);
      try {
        await ensureAmazonSyncInitialized(target, authId);
        const finished = await prisma.amazonSyncDataSource.findMany({ where: { ...target, authorizationId: authId } });
        assert.equal(finished.length, eligibleAdapters.length);
        assert.ok(finished.some(s => s.id === discovered[0].id), "existing source identity must survive discovery");
        assert.equal(await prisma.amazonSyncSchedule.count({ where: target }), eligibleAdapters.length);
        // Product detail adapters wait for their first published catalog snapshot.
        const runnable = eligibleAdapters.filter(a => !("requiresMarketplaceCatalogSource" in a && a.requiresMarketplaceCatalogSource)).length;
        assert.equal(await prisma.amazonSyncRun.count({ where: target }), runnable);
        await ensureAmazonSyncInitialized(target, authId);
        assert.equal(await prisma.amazonSyncRun.count({ where: target }), runnable);
        assert.equal(calls.length, beforeCalls, "discovery and scheduling must not collect on the foreground thread");
      } finally { process.env.AMAZON_SYNC_CENTER_SCOPES = configuredScopes; }
    });
    await t.test("newly supported sources receive plans even after 200 already-planned sources", async () => {
      const accounts = Array.from({ length: 201 }, () => randomUUID());
      const ids = accounts.map(() => randomUUID());
      await prisma.sellerAccount.createMany({ data: accounts.map(id => ({ ...scope, id, accountKey: `fixture-${id}`, displayName: "Fixture capacity", marketplaceCode: "US" })) });
      await prisma.amazonSyncDataSource.createMany({ data: ids.map((id, i) => ({ ...scope, id, authorizationId: completed.authorizationId, sellerAccountId: accounts[i], marketplaceId: site, resource: "inventory", freshnessMinutes: 360 })) });
      const planned = ids.slice(0, 200);
      await prisma.amazonSyncSchedule.createMany({ data: planned.map(id => ({ ...scope, id: `fixture-${id}`, resource: "inventory", executionVersion: 2, planKey: `auto-v1:${id}`, enabled: false, updatedByUserId: actor })) });
      await prisma.amazonSyncPlanTarget.createMany({ data: planned.map(id => ({ ...scope, scheduleId: `fixture-${id}`, sourceId: id })) });
      await ensureAmazonSyncInitialized(scope, completed.authorizationId);
      const last = ids.at(-1)!;
      const plan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { targets: { some: { sourceId: last } } } });
      assert.equal(plan.enabled, true);
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: last, trigger: "schedule" } }), 1);
      assert.equal(await prisma.amazonSyncSchedule.count({ where: { id: { in: planned.map(id => `fixture-${id}`) }, enabled: false } }), 200, "discovery must preserve existing disabled plans");
    });
    await t.test("missing registry policies and active unplanned tasks cannot starve a ready new source", async () => {
      const accounts = Array.from({ length: 401 }, () => randomUUID());
      const ids = accounts.map(() => randomUUID()), blockedTasks = ids.slice(200, 400).map(() => randomUUID());
      const old = new Date("2020-01-01T00:00:00Z"), last = ids.at(-1)!;
      await prisma.sellerAccount.createMany({ data: accounts.map(id => ({ ...scope, id, accountKey: `fixture-${id}`, displayName: "Fixture readiness", marketplaceCode: "US" })) });
      await prisma.amazonSyncDataSource.createMany({ data: ids.map((id, i) => ({ ...scope, id, authorizationId: completed.authorizationId,
        sellerAccountId: accounts[i], marketplaceId: site, resource: i < 200 ? "orders" : "inventory", freshnessMinutes: 360,
        // Both SQL NULL and JSON null represent missing adapter prerequisites.
        ...(i < 200 ? { orderPolicy: i % 2 ? Prisma.JsonNull : Prisma.DbNull } : {}), createdAt: i < 400 ? old : new Date() })) });
      await prisma.amazonSyncRun.createMany({ data: blockedTasks.map((id, i) => ({ ...scope, id, sourceId: ids[i + 200],
        requestedByUserId: actor, resource: "inventory", mode: "snapshot", executionVersion: 2, status: "RUNNING" })) });
      const callsBefore = calls.length;
      await ensureAmazonSyncInitialized(scope, completed.authorizationId);
      const readyPlan = await prisma.amazonSyncSchedule.findFirstOrThrow({ where: { targets: { some: { sourceId: last } } } });
      assert.equal(readyPlan.enabled, true);
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: last, trigger: "schedule" } }), 1);
      assert.equal(await prisma.amazonSyncPlanTarget.count({ where: { sourceId: { in: ids.slice(0, 400) } } }), 0);
      assert.equal(await prisma.amazonSyncRun.count({ where: { id: { in: blockedTasks }, status: "RUNNING", dispatchVersion: 0 } }), 200);
      await ensureAmazonSyncInitialized(scope, completed.authorizationId);
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: last, trigger: "schedule" } }), 1);
      assert.equal(await prisma.amazonSyncSchedule.count({ where: { targets: { some: { sourceId: last } } } }), 1);
      // Readiness is not a permanent exclusion: a configured policy or a
      // completed original task makes that source eligible on the next scan.
      const ordersTemplate = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "orders", orderPolicy: { not: Prisma.AnyNull } } });
      await prisma.amazonSyncDataSource.update({ where: { id: ids[0] }, data: { orderPolicy: ordersTemplate.orderPolicy as Prisma.InputJsonValue } });
      await prisma.amazonSyncRun.update({ where: { id: blockedTasks[0] }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
      await ensureAmazonSyncInitialized(scope, completed.authorizationId);
      for (const id of [ids[0], ids[200]]) {
        assert.equal(await prisma.amazonSyncSchedule.count({ where: { targets: { some: { sourceId: id } } } }), 1);
        assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: id, trigger: "schedule" } }), 1);
      }
      assert.equal(calls.length, callsBefore, "initialization queues background work without foreground Amazon requests");
    });
    await t.test("invalid non-null policies rotate durably without blocking later sources and corrected policies rejoin automatically", async () => {
      const accounts = Array.from({ length: 201 }, () => randomUUID()), ids = accounts.map(() => randomUUID());
      const invalid = ids.slice(0, 200), last = ids.at(-1)!, old = new Date("2019-01-01T00:00:00Z");
      await prisma.sellerAccount.createMany({ data: accounts.map(id => ({ ...scope, id, accountKey: `fixture-${id}`, displayName: "Fixture invalid policy", marketplaceCode: "US" })) });
      await prisma.amazonSyncDataSource.createMany({ data: ids.map((id, i) => ({ ...scope, id, authorizationId: completed.authorizationId,
        sellerAccountId: accounts[i], marketplaceId: site, resource: i === 200 ? "inventory" : i % 2 ? "pricing" : "orders", freshnessMinutes: 360,
        ...(i < 200 ? i % 2 ? { domainPolicy: "fixture-private-invalid-policy" } : { orderPolicy: {} } : {}),
        createdAt: i < 200 ? old : new Date(), updatedAt: i < 200 ? old : new Date() })) });
      const configuration = () => prisma.amazonSyncDataSource.findMany({ where: { id: { in: invalid } }, orderBy: { id: "asc" },
        select: { id: true, revision: true, orderPolicy: true, domainPolicy: true, coverage: true, activeRunId: true } });
      const before = await configuration(), beforeCalls = calls.length;
      const at = new Date(Date.now() + 1000);
      await ensureAmazonSyncInitialized(scope, completed.authorizationId, at);
      assert.equal(await prisma.amazonSyncPlanTarget.count({ where: { sourceId: { in: ids } } }), 0, "invalid configuration must not create a plan");
      assert.equal(await prisma.amazonSyncDataSource.count({ where: { id: { in: invalid }, updatedAt: at } }), 200);
      const audits = await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId, entityId: { in: invalid }, action: "amazon.sync.plan.policy-invalid" } });
      assert.equal(audits.length, 200); assert.ok(!JSON.stringify(audits).includes("fixture-private-invalid-policy"));
      assert.deepEqual(await configuration(), before, "inspection changes metadata only, never configuration, revision or business state");
      // A new invocation uses persisted ordering, not an in-memory cursor.
      await ensureAmazonSyncInitialized(scope, completed.authorizationId, at);
      assert.equal(await prisma.amazonSyncSchedule.count({ where: { targets: { some: { sourceId: last } } } }), 1);
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: last, trigger: "schedule" } }), 1);
      assert.equal(await prisma.amazonSyncPlanTarget.count({ where: { sourceId: { in: invalid } } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { organizationId: scope.organizationId, entityId: { in: invalid }, action: "amazon.sync.plan.policy-invalid" } }), 200, "unchanged invalid revision is audited once");
      const template = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "orders", orderPolicy: { not: Prisma.AnyNull }, id: { notIn: invalid } } });
      await prisma.amazonSyncDataSource.update({ where: { id: invalid[0] }, data: { orderPolicy: template.orderPolicy as Prisma.InputJsonValue, revision: { increment: 1 } } });
      await ensureAmazonSyncInitialized(scope, completed.authorizationId, new Date(at.getTime() + 1));
      assert.equal(await prisma.amazonSyncSchedule.count({ where: { targets: { some: { sourceId: invalid[0] } } } }), 1);
      assert.equal(await prisma.amazonSyncRun.count({ where: { sourceId: invalid[0], trigger: "schedule" } }), 1);
      assert.equal(calls.length, beforeCalls, "policy validation and discovery perform no Amazon HTTP");
    });
    await t.test("reinitialization never restores a revoked account assignment", async () => {
      await prisma.amazonDataAccessGrant.updateMany({ where: { ...scope, sellerAccountId, userId: actor }, data: { enabled: false } });
      await ensureAmazonSyncInitialized(scope, completed.authorizationId);
      assert.equal(await prisma.amazonDataAccessGrant.count({ where: { ...scope, sellerAccountId, userId: actor, enabled: true } }), 0);
    });
  } finally { globalThis.fetch = previousFetch; }
});
