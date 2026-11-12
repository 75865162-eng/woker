import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, scryptSync } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import net from "node:net";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { prisma } from "@/lib/db/prisma";
import { readSalesHistoryCoverage } from "@/lib/amazon-sync/sales-history";
import { nextSalesTrafficRange } from "@/lib/amazon-sync/automatic-schedule";
import { shiftDate } from "@/lib/amazon-sync/date-range";
import { unseal } from "@/lib/amazon-sync/approval-policy";
import { mcpTokenHash } from "@/lib/amazon-sync/mcp";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { restoreNextEnvironment } from "../../scripts/runtime/generated-types-cleanup.mjs";

if (process.env.AMAZON_SYNC_PROCESS_FIXTURE !== "1" || process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1"
  || new URL(process.env.DATABASE_URL!).pathname !== "/amazon_sync_test") throw Error("Disposable runner required");
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(fn: () => Promise<T | false | undefined | null>, label: string, timeout = 90000): Promise<T> {
  const start = performance.now(); let last: unknown;
  while (performance.now() - start < timeout) { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await pause(250); }
  throw Error(`Fixture timeout: ${label}; last=${last instanceof Error ? last.message : "no state"}`);
}
async function freePort() {
  const server = net.createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}

test("registered process Worker and real ERP/MCP/Lili HTTP share a recoverable publication lifecycle", { timeout: 600000 }, async t => {
  const scope = { organizationId: `process-fixture-${randomUUID()}`, workspaceId: "default" }, actor = randomUUID(), site = "ATVPDKIKX0DER";
  const directory = await mkdtemp(path.join(tmpdir(), "sp-api-process-")), clock = path.join(directory, "clock");
  const beforeTypes = await readFile("next-env.d.ts", "utf8");
  const dist = `.next-process-${randomUUID().slice(0, 8)}`, children: ChildProcess[] = [], logs: string[] = [], evidence: Array<Record<string, unknown>> = [];
  const calls: Array<{ path: string; page: string | null; status: number; method: string }> = [];
  const reports = new Map<string, { dataStartTime: string; dataEndTime: string; reportOptions: unknown; reportType: string; marketplaceIds: string[] }>();
  let createFault = true, downloadFault = true, timeoutNext = false;
  let throttle = true, hang = true, held: ServerResponse | undefined, clockOffset = 0, inventoryVersion = 1;
  const mocked = createServer(async (req, res) => {
    if (req.headers["x-fixture-key"] !== "fixture-process-key") { res.writeHead(403).end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString()) as { url: string; method: string; body: string | null };
    const url = new URL(input.url);
    const item = { path: url.pathname, page: url.searchParams.get("nextToken"), status: 200, method: input.method }; calls.push(item);
    const send = (body: unknown, status = 200) => { item.status = status; res.writeHead(status, { "content-type": "application/json", "x-amzn-RateLimit-Limit": "1000", "retry-after": "1" }); res.end(JSON.stringify(body)); };
    if (url.hostname === "api.amazon.com") return send({ access_token: "fixture-process-access", refresh_token: "fixture-process-refresh", expires_in: 3600 });
    if (url.pathname.includes("marketplaceParticipations")) return send({ payload: [{ marketplace: { id: site }, participation: { isParticipating: true } }] });
    if (url.pathname.startsWith("/listings/2021-08-01/items/")) return send({ items: [] });
    if (url.pathname.includes("/fba/inventory/")) {
      if (item.page && throttle) { throttle = false; return send({ errors: [{ code: "QuotaExceeded" }] }, 429); }
      if (item.page && hang) { held = res; return; }
      if (item.page && timeoutNext) { timeoutNext = false; item.status = 0; held = res; return; }
      const start = item.page ? 50 : 0, count = item.page ? 3 : 50;
      return send({ payload: { inventorySummaries: Array.from({ length: count }, (_, i) => ({ sellerSku: `FIXTURE-${String(start + i).padStart(3, "0")}`,
        asin: "B012345678", condition: "NewItem", totalQuantity: inventoryVersion, inventoryDetails: { fulfillableQuantity: inventoryVersion, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: { totalReservedQuantity: 0 }, unfulfillableQuantity: { totalUnfulfillableQuantity: 0 }, researchingQuantity: { totalResearchingQuantity: 0 } },
        futureAttribute: { nested: { exact: "9007199254740993" } } })) }, ...(item.page ? {} : { pagination: { nextToken: "fixture-page-2" } }) });
    }
    if (url.pathname === "/reports/2021-06-30/reports" && input.method === "POST") {
      const spec = JSON.parse(input.body!);
      if (spec.reportType === "GET_SALES_AND_TRAFFIC_REPORT" && String(spec.dataStartTime).includes("T")) {
        const id = `fixture-sales-${reports.size + 1}`; reports.set(id, spec);
        if (createFault) { createFault = false; item.status = 0; res.destroy(); return; }
        return send({ reportId: id });
      }
    }
    if (url.pathname === "/reports/2021-06-30/reports" && input.method === "GET" && url.searchParams.get("reportTypes") === "GET_SALES_AND_TRAFFIC_REPORT") return send({ reports: [...reports].map(([reportId, spec]) => ({ reportId, reportType: spec.reportType, marketplaceIds: spec.marketplaceIds, createdTime: new Date(Date.now() + clockOffset - 1000).toISOString(), dataStartTime: spec.dataStartTime, dataEndTime: spec.dataEndTime })) });
    const reportId = url.pathname.split("/").at(-1)!;
    if (url.pathname.startsWith("/reports/2021-06-30/reports/") && reports.has(reportId)) return send({ reportId, reportType: "GET_SALES_AND_TRAFFIC_REPORT", marketplaceIds: [site], processingStatus: "DONE", reportDocumentId: reportId });
    if (url.pathname.startsWith("/reports/2021-06-30/documents/") && reports.has(reportId)) return send({ reportDocumentId: reportId, url: `https://fixture.s3.amazonaws.com/${reportId}` });
    if (url.hostname === "fixture.s3.amazonaws.com" && reports.has(reportId)) {
      if (downloadFault) { downloadFault = false; item.status = 0; res.destroy(); return; }
      const spec = reports.get(reportId)!; const rows = [];
      for (let date = spec.dataStartTime.slice(0, 10); date <= spec.dataEndTime.slice(0, 10); date = shiftDate(date, 1)) rows.push({ date, salesByDate: { unitsOrdered: 1, totalOrderItems: 1, orderedProductSales: { amount: 2, currencyCode: "USD" } }, trafficByDate: { sessions: 1, pageViews: 1 } });
      return send({ reportSpecification: spec, salesAndTrafficByDate: rows });
    }
    return send({ errors: [{ code: "AccessDenied" }] }, 403);
  });
  await new Promise<void>(resolve => mocked.listen(0, "127.0.0.1", resolve));
  const mockBase = `http://127.0.0.1:${(mocked.address() as net.AddressInfo).port}`, port = await freePort(), base = `http://127.0.0.1:${port}`;
  await writeFile(clock, "0");
  const advance = async (ms: number) => { clockOffset += ms; await writeFile(clock, String(clockOffset)); };
  const env: NodeJS.ProcessEnv = { ...process.env, ERP_RUNTIME_MODE: "production", NODE_ENV: "development", AMAZON_API_EXECUTION_ROLE: "cloud", NEXT_TELEMETRY_DISABLED: "1",
    AMAZON_SP_API_ENCRYPTION_KEY: Buffer.alloc(32, 85).toString("base64"), AMAZON_SYNC_CENTER_SCOPES: JSON.stringify([[scope.organizationId, scope.workspaceId]]),
    AMAZON_SP_API_APPLICATION_ID: "fixture-process-app", AMAZON_SP_API_LWA_CLIENT_ID: "fixture-process-client", AMAZON_SP_API_LWA_CLIENT_SECRET: "fixture-process-secret",
    AMAZON_SP_API_OAUTH_REDIRECT_URI: base + "/api/integrations/amazon/sp-api/oauth/callback", AMAZON_SYNC_WORKER_ID: "process-fixture-worker", AMAZON_SYNC_WORKER_NAME: "process-fixture-worker",
    AMAZON_SYNC_FIXTURE_HTTP: mockBase, AMAZON_SYNC_FIXTURE_CLOCK: clock, AMAZON_SYNC_FIXTURE_KEY: "fixture-process-key", AMAZON_SYNC_FIXTURE_WEB_PORT: String(port),
    NODE_OPTIONS: `--import=${pathToFileURL(path.resolve("tests/helpers/amazon-process-preload.mjs")).href}` };
  const start = (args: string[]) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"], detached: true }); children.push(child);
    child.stdout!.on("data", value => { logs.push(String(value)); void writeFile(path.join(directory, "process.log"), logs.join("")); }); child.stderr!.on("data", value => { logs.push(String(value)); void writeFile(path.join(directory, "process.log"), logs.join("")); }); return child;
  };
  const http = (url: string, init: RequestInit = {}) => fetch(base + url, { ...init, signal: AbortSignal.timeout(45000) });
  let cookie = "";
  const token = "amcp_" + "p".repeat(43);
  const jsonHeaders = () => ({ "content-type": "application/json", cookie });
  try {
    await prisma.organization.create({ data: { id: scope.organizationId, slug: scope.organizationId, name: "Process fixture" } });
    await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "Fixture" } });
    await prisma.user.create({ data: { id: actor, email: `${actor}@fixture.invalid`, name: "Fixture", passwordHash: `scrypt:fixture:${scryptSync("fixture-password", "fixture", 64).toString("base64url")}`,
      memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
    start(["scripts/next-run.mjs", dist, "dev", "--turbopack", "--hostname", "127.0.0.1", "--port", String(port)]);
    await until(async () => (await http("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status === 400, "isolated web ready", 150000);
    const login = await http("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${actor}@fixture.invalid`, password: "fixture-password" }) });
    assert.equal(login.status, 200, await login.clone().text()); cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    await t.test("real login and OAuth HTTP callback discover resources and enqueue work idempotently", async () => {
      const begin = await http("/api/integrations/amazon/sp-api/oauth/start", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ region: "us-east-1" }) });
      assert.equal(begin.status, 200, await begin.clone().text());
      const consent = await begin.json();
      const callback = await http(`/api/integrations/amazon/sp-api/oauth/callback?${new URLSearchParams({ state: new URL(consent.consentUrl).searchParams.get("state")!, selling_partner_id: "PROCESSFIXTURE1", spapi_oauth_code: "fixture-process-code" })}`, { headers: { cookie }, redirect: "manual" });
      assert.equal(callback.status, 303, await callback.clone().text());
      assert.equal(await prisma.amazonSyncDataSource.count({ where: scope }), 17);
      assert.equal(await prisma.amazonSyncSchedule.count({ where: { ...scope, executionVersion: 2 } }), 17);
      const before = await prisma.amazonSyncRun.count({ where: scope }); assert.ok(before > 0 && before <= 17);
      const repeat = await http(`/api/integrations/amazon/sp-api/oauth/callback?${new URLSearchParams({ state: new URL(consent.consentUrl).searchParams.get("state")!, selling_partner_id: "PROCESSFIXTURE1", spapi_oauth_code: "fixture-process-code" })}`, { headers: { cookie }, redirect: "manual" });
      assert.equal(repeat.status, 403); assert.equal(await prisma.amazonSyncRun.count({ where: scope }), before);
      evidence.push({ scenario: "OAuth HTTP", sources: 17, plans: 17, tasks: before, duplicateCallback: 403 });
    });
    assert.equal(evidence.length, 1, "OAuth scenario must pass before Worker tests");
    const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "inventory" } });
    const original = await prisma.amazonSyncRun.findFirstOrThrow({ where: { sourceId: source.id } });
    const state = () => prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: original.id } });
    const inventoryCalls = () => calls.filter(call => call.path.includes("/fba/inventory/"));
    // Transaction fault is non-transactionally counted, so only the first real
    // publication transaction fails; no scheduler or processor function is called.
    await prisma.$executeRawUnsafe("CREATE SEQUENCE fixture_process_publication_attempt");
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_process_publication_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${source.id}' AND NEW."activeRunId" IS DISTINCT FROM OLD."activeRunId" AND nextval('fixture_process_publication_attempt')=1 THEN RAISE EXCEPTION 'fixture publication SQL failure' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe("CREATE TRIGGER fixture_process_publication_failure BEFORE UPDATE ON \"AmazonSyncDataSource\" FOR EACH ROW EXECUTE FUNCTION fixture_process_publication_failure()");
    const manager = start(["scripts/runtime/worker-manager.mjs", "amazon-sync"]);
    await t.test("actual queue Worker commits page one then throttles without publishing", async () => {
      const failed = await until(async () => { const run = await state(); return run.status === "RETRY_WAIT" && run.throttles === 1 && run; }, "429 after first committed page");
      assert.equal(failed.pagesCompleted, 1); assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: original.id, page: { gt: 0 } } }), 1);
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, null);
      evidence.push({ scenario: "429 + pagination", taskId: original.id, status: failed.status, pages: failed.pagesCompleted, requests: inventoryCalls().length, archives: 1, errorArchives: await prisma.amazonSyncRawPage.count({ where: { taskId: original.id, page: { lt: 0 } } }), published: false });
    });
    assert.equal(evidence.length, 2, "page one must commit before recovery tests");
    await t.test("SIGKILL registered Worker, expired lease takeover and archived publication retry preserve original task", async () => {
      await advance(60000);
      await until(async () => !!held, "in-flight page two");
      const heartbeat = await prisma.workerHeartbeat.findUniqueOrThrow({ where: { id: "process-fixture-worker" } });
      const oldPid = (heartbeat.metadata as { pid: number }).pid; assert.ok(oldPid > 0 && manager.pid !== oldPid);
      process.kill(oldPid, "SIGKILL"); hang = false; held?.destroy();
      await advance(360000);
      await until(async () => { const run = await state(); return ["RETRY_WAIT", "FAILED"].includes(run.status) && (run.summary as { quality?: { code?: string } })?.quality?.code === "DATABASE_TRANSIENT" && run; }, "real publication transaction failure");
      const requestsBefore = inventoryCalls().length;
      assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: original.id, page: { gt: 0 } } }), 2);
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, null);
      await advance(16 * 60000);
      const done = await until(async () => { const run = await state(); return run.status === "SUCCEEDED" && run; }, "same task publishes from original");
      assert.equal(inventoryCalls().length, requestsBefore, "publication retry must not refetch either page");
      assert.equal(inventoryCalls().filter(call => !call.page).length, 1);
      assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: original.id } }), 53);
      assert.equal(done.pagesCompleted, 2);
      evidence.push({ scenario: "SIGKILL + lease + publication failure", taskId: done.id, status: done.status, attempts: done.attempts, generation: done.dispatchVersion,
        requests: requestsBefore, pageOneRequests: 1, archives: 2, rows: 53, publicationRetryRequests: 0 });
    });
    assert.equal(evidence.length, 3, "publication must succeed before HTTP tests");
    await t.test("ERP, native MCP and Lili HTTP return identical published first/last pages", async () => {
      await prisma.amazonMcpCredential.create({ data: { ...scope, id: randomUUID(), userId: actor, name: "Process fixture", tokenHash: mcpTokenHash(token), tokenPrefix: token.slice(0, 12),
        scopes: [], tools: [], createdByUserId: actor, expiresAt: new Date(Date.now() + 3 * 86400000) } });
      for (const page of [1, 2]) {
        const args = { table: "inventory", sellerAccountId: source.sellerAccountId, marketplaceId: site, page, pageSize: 50 };
        const erp = await http(`/api/operations/sync-center?${new URLSearchParams({ section: "data", ...Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)])) })}`, { headers: { cookie } });
        assert.equal(erp.status, 200, await erp.clone().text()); const erpData = await erp.json();
        const mcp = await http("/api/mcp/amazon", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: page, method: "tools/call", params: { name: "data_query", arguments: args } }) });
        assert.equal(mcp.status, 200, await mcp.clone().text()); const mcpData = JSON.parse((await mcp.json()).result.content[0].text);
        const lili = await http("/api/lili/tools/run", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ name: "erp__data_query", input: args }) });
        assert.equal(lili.status, 200, await lili.clone().text()); const liliData = await lili.json();
        assert.deepEqual(erpData.data, mcpData.data); assert.deepEqual(erpData.data, liliData.result.data);
        assert.equal(erpData.data.total, 53); assert.equal(erpData.data.items.length, page === 1 ? 50 : 3);
        const encoded = JSON.stringify([erpData, mcpData, liliData]);
        for (const secret of ["fixture-process-access", "fixture-process-refresh", "fixture-process-secret", token]) assert.ok(!encoded.includes(secret));
      }
      for (const changed of [{ sellerAccountId: randomUUID() }, { marketplaceId: "A2EUQ1WTGCTBG2" }]) {
        const args = { table: "inventory", sellerAccountId: source.sellerAccountId, marketplaceId: site, ...changed };
        const erp = await http(`/api/operations/sync-center?${new URLSearchParams({ section: "data", ...args })}`, { headers: { cookie } });
        assert.ok([403, 409].includes(erp.status), await erp.text());
        const mcp = await http("/api/mcp/amazon", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "data_query", arguments: args } }) });
        const denied = await mcp.json(); assert.ok(mcp.status === 403 || denied.error || denied.result?.isError, JSON.stringify(denied));
        const lili = await http("/api/lili/tools/run", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ name: "erp__data_query", input: args }) });
        assert.ok([403, 409].includes(lili.status), await lili.text());
      }
      const unknown = await prisma.amazonFieldObservation.findMany({ where: { ...scope, rawTaskId: original.id } });
      process.env.AMAZON_SP_API_ENCRYPTION_KEY = env.AMAZON_SP_API_ENCRYPTION_KEY;
      const raw = await prisma.amazonSyncRawPage.findUniqueOrThrow({ where: { taskId_page: { taskId: original.id, page: 2 } } });
      const envelope = unseal(raw.rawCiphertext, scope, `${original.id}:2`, "amazon-inventory-raw.v1");
      assert.equal(JSON.parse(String(envelope.rawBody)).payload.inventorySummaries[0].futureAttribute.nested.exact, "9007199254740993");
      assert.ok(unknown.length > 0, "unknown nested fields must retain archive observations");
      evidence.push({ scenario: "real HTTP ERP/MCP/Lili", crossAccountAndSiteDenied: true, unknownNestedFieldObservations: unknown.length, total: 53, firstRows: 50, lastRows: 3, sameData: true, secretsLeaked: false });
    });
    await t.test("duplicate completed task delivery does not request, insert or republish", async () => {
      const before = inventoryCalls().length, done = await state();
      const queue = getAmazonSyncQueue();
      const job = await queue.add("process-amazon-sync-run", { runId: done.id, dispatchVersion: done.dispatchVersion }, { jobId: `fixture-duplicate-${randomUUID()}`, removeOnComplete: false });
      await until(async () => (await job.getState()) === "completed", "duplicate queue delivery");
      assert.equal(inventoryCalls().length, before); assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: done.id } }), 53);
      evidence.push({ scenario: "duplicate queue delivery", requests: 0, rows: 53, taskId: done.id });
    });
    await t.test("clock advances schedule cadence; Redis restart retains database intent and publishes a fresh version", async () => {
      await prisma.$executeRawUnsafe("CREATE SEQUENCE fixture_process_insert_attempt");
      await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_process_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sellerSku"='FIXTURE-050' AND NEW."fulfillableQuantity"=9 AND nextval('fixture_process_insert_attempt')=1 THEN RAISE EXCEPTION 'fixture insertion SQL failure' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`);
      await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_process_insert_failure BEFORE INSERT ON "AmazonInventorySnapshot" FOR EACH ROW EXECUTE FUNCTION fixture_process_insert_failure()');
      inventoryVersion = 9;
      const container = process.env.AMAZON_SYNC_FIXTURE_REDIS_CONTAINER!;
      const label = execFileSync("docker", ["inspect", "-f", '{{index .Config.Labels "codex.task"}}', container], { encoding: "utf8" }).trim();
      assert.equal(label, "amazon-sync-integration");
      execFileSync("docker", ["restart", container], { stdio: "pipe" });
      await advance(3600000);
      const interrupted = await until(async () => prisma.amazonSyncRun.findFirst({ where: { sourceId: source.id, id: { not: original.id }, status: "RETRY_WAIT" } }), "parsed page two database insertion interruption");
      assert.equal(interrupted.pagesCompleted, 1);
      assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: interrupted.id, page: { gt: 0 } } }), 2);
      assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: interrupted.id } }), 50);
      const beforeInsertReplay = inventoryCalls().length;
      await advance(60000);
      const next = await until(async () => prisma.amazonSyncRun.findFirst({ where: { sourceId: source.id, id: interrupted.id, status: "SUCCEEDED" }, orderBy: { startedAt: "desc" } }), "automatic post-cadence publication");
      assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, next.id);
      const rows = await prisma.amazonInventorySnapshot.findMany({ where: { syncRunId: next.id } });
      assert.equal(rows.length, 53); assert.ok(rows.every(row => row.fulfillableQuantity === 9));
      assert.equal(inventoryCalls().length, beforeInsertReplay, "DB insertion replay must reuse archived page two");
      const before = inventoryCalls().length;
      const job = await getAmazonSyncQueue().add("process-amazon-sync-run", { runId: original.id, dispatchVersion: original.dispatchVersion }, { jobId: `fixture-stale-${randomUUID()}`, removeOnComplete: false });
      await until(async () => (await job.getState()) === "completed", "old task after newer publication");
      assert.equal(inventoryCalls().length, before); assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId, next.id);
      evidence.push({ scenario: "Redis restart + insertion recovery + automatic cadence + old delivery", insertionInterruptedRows: 50, insertionInterruptedPages: 1, insertionRetryRequests: 0, taskId: next.id, previousTask: original.id, rows: 53, quantity: 9, oldDeliveryRequests: 0 });
    });
    await t.test("real Worker fills every sales history window and then refreshes recent data after transport/download recovery", async () => {
      const sales = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "sales_traffic" }, include: { authorization: true } });
      let complete = false;
      for (let step = 0; step < 180; step++) {
        const coverage = await readSalesHistoryCoverage(scope, sales, new Date(Date.now() + clockOffset));
        if (nextSalesTrafficRange(site, new Date(Date.now() + clockOffset), coverage).refresh) { complete = true; break; }
        await advance(120000); await pause(750);
      }
      assert.ok(complete, "all 730 policy days must be collected by real Worker, without synthetic coverage evidence");
      const windows = [...reports.values()];
      const reconciliations = calls.filter(call => call.method === "GET" && call.status === 200 && call.path === "/reports/2021-06-30/reports").length;
      assert.ok(reconciliations > 0, "lost create response must be reconciled by the real Worker");
      assert.equal(calls.filter(call => call.status === 0 && call.method === "POST" && call.path === "/reports/2021-06-30/reports").length, 1);
      assert.equal(new Set(windows.map(window => window.dataStartTime)).size, windows.length, "completed history intervals must not be requested twice");
      const completed = await prisma.amazonSyncRun.findMany({ where: { sourceId: sales.id, status: "SUCCEEDED" } });
      assert.ok(completed.length >= 24);
      const coverage = await readSalesHistoryCoverage(scope, sales, new Date(Date.now() + clockOffset));
      assert.equal(coverage.length, 1);
      const count = reports.size;
      await advance(24 * 3600000 + 60000);
      for (let step = 0; step < 20 && reports.size === count; step++) { await advance(120000); await pause(750); }
      assert.ok(reports.size > count, "same plan must automatically request recent correction window");
      const recent = [...reports.values()].at(-1)!;
      assert.ok(recent.dataStartTime > windows[0].dataEndTime, JSON.stringify({ first: windows[0], recent, coverage }));
      let recentPublished = false;
      for (let step = 0; step < 12; step++) {
        const run = await prisma.amazonSyncRun.findFirst({ where: { sourceId: sales.id, status: "SUCCEEDED", frozenScope: { path: ["requestedRange", "from"], equals: recent.dataStartTime.slice(0, 10) } } });
        if (run) { recentPublished = true; break; }
        await advance(120000); await pause(750);
      }
      assert.ok(recentPublished, "automatic recent window must publish before acceptance");
      evidence.push({ scenario: "Worker sales 730-day history and recent correction", recentPublished, creationReconcileRequests: reconciliations, completedWindows: completed.length, coverage, reports: count, requestedWindows: windows.map(window => ({ from: window.dataStartTime, to: window.dataEndTime })), networkFailures: calls.filter(call => call.status === 0).length, automaticRecentWindow: recent });
    });
    await t.test("confirmed zero and forbidden data remain distinct while an independent domain publishes", async () => {
      const catalog = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "catalog" } });
      const empty = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: catalog.activeRunId! } });
      assert.equal(empty.status, "SUCCEEDED"); assert.equal(empty.insertedCount, 0); assert.equal(empty.paginationComplete, true);
      assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: empty.id, page: { gt: 0 } } }), 1);
      const orders = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, resource: "orders" } });
      const rejected = await prisma.amazonSyncRun.findMany({ where: { sourceId: orders.id } });
      assert.equal(rejected.length, 1); assert.equal(rejected[0].status, "FAILED");
      assert.equal((rejected[0].summary as { quality: { code: string } }).quality.code, "API_REJECTED");
      assert.equal(orders.activeRunId, null); assert.equal(rejected[0].attempts, 1);
      assert.ok((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId);
      evidence.push({ scenario: "zero vs forbidden and domain isolation", confirmedZeroStatus: empty.status, zeroRawPages: 1, forbiddenStatus: rejected[0].status, forbiddenPublished: false, forbiddenAttempts: 1, independentInventoryPublished: true });
    });
    await t.test("actual API timeout resumes the same paginated task without requesting its completed first page", async () => {
      inventoryVersion = 17; timeoutNext = true;
      const firstCalls = inventoryCalls().filter(call => !call.page).length;
      await advance(3600000);
      const interrupted = await until(async () => prisma.amazonSyncRun.findFirst({ where: { sourceId: source.id, status: "RETRY_WAIT" }, orderBy: { startedAt: "desc" } }), "real HTTP timeout retry state");
      assert.equal(interrupted.pagesCompleted, 1); assert.equal(interrupted.insertedCount, 50);
      assert.equal((interrupted.summary as { quality: { code: string } }).quality.code, "TRANSIENT");
      const head = (await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: source.id } })).activeRunId;
      assert.notEqual(head, interrupted.id);
      await advance(60000);
      await until(async () => (await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: interrupted.id } })).status === "SUCCEEDED", "timeout recovery publication");
      assert.equal(inventoryCalls().filter(call => !call.page).length, firstCalls + 1);
      assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: interrupted.id } }), 53);
      evidence.push({ scenario: "actual HTTP timeout", taskId: interrupted.id, failedStatus: "RETRY_WAIT", committedPages: 1, committedRows: 50, finalStatus: "SUCCEEDED", finalRows: 53, repeatedCompletedPageRequests: 0 });
    });
    await t.test("terminated PostgreSQL transaction connection recovers from archived parsed page", async () => {
      await prisma.$executeRawUnsafe("CREATE SEQUENCE fixture_connection_attempt");
      await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_connection_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sellerSku"='FIXTURE-050' AND NEW."fulfillableQuantity"=21 AND nextval('fixture_connection_attempt')=1 THEN PERFORM pg_sleep(10); END IF; RETURN NEW; END $$`);
      await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_connection_pause BEFORE INSERT ON "AmazonInventorySnapshot" FOR EACH ROW EXECUTE FUNCTION fixture_connection_pause()');
      inventoryVersion = 21; const before = inventoryCalls().length;
      await advance(3600000);
      const pid = await until(async () => {
        const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='PgSleep' AND query LIKE '%AmazonInventorySnapshot%'`;
        return rows[0]?.pid;
      }, "actual Worker transaction blocked in fixture trigger");
      const killed = await prisma.$queryRaw<Array<{ terminated: boolean }>>`SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE pid=${pid} AND datname=current_database() AND wait_event='PgSleep' AND query LIKE '%AmazonInventorySnapshot%'`;
      assert.equal(killed[0]?.terminated, true);
      const interrupted = await until(async () => prisma.amazonSyncRun.findFirst({ where: { sourceId: source.id, status: { in: ["RETRY_WAIT", "FAILED"] } }, orderBy: { startedAt: "desc" } }), "database disconnection retry state");
      assert.equal(interrupted.status, "RETRY_WAIT");
      assert.equal(interrupted.pagesCompleted, 1); assert.equal(interrupted.insertedCount, 50);
      assert.equal((interrupted.summary as { quality: { code: string } }).quality.code, "DATABASE_TRANSIENT");
      assert.equal(await prisma.amazonSyncRawPage.count({ where: { taskId: interrupted.id, page: { gt: 0 } } }), 2);
      const requests = inventoryCalls().length; assert.equal(requests - before, 2);
      await advance(60000);
      await until(async () => (await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: interrupted.id } })).status === "SUCCEEDED", "database reconnection and archive replay publication");
      assert.equal(inventoryCalls().length, requests); assert.equal(await prisma.amazonInventorySnapshot.count({ where: { syncRunId: interrupted.id } }), 53);
      evidence.push({ scenario: "PostgreSQL connection terminated during transaction", taskId: interrupted.id, failedStatus: "RETRY_WAIT", committedPages: 1, committedRows: 50, archives: 2, requests: 2, retryRequests: 0, finalStatus: "SUCCEEDED", finalRows: 53 });
    });
    await t.test("expired authorization stops Worker requests; fresh OAuth callback reuses sources and plans", async () => {
      const auth = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: source.authorizationId } });
      await prisma.amazonSpApiAuthorization.update({ where: { id: auth.id }, data: { status: "ERROR", validationErrorCode: "AUTH_REJECTED", revision: { increment: 1 } } });
      await pause(750); const before = calls.length;
      await advance(2 * 3600000); await pause(2000);
      assert.equal(calls.length, before, "expired account must issue no Amazon requests");
      const loginAgain = await http("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${actor}@fixture.invalid`, password: "fixture-password" }) });
      assert.equal(loginAgain.status, 200); cookie = loginAgain.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
      const begin = await http("/api/integrations/amazon/sp-api/oauth/start", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ region: "us-east-1" }) });
      assert.equal(begin.status, 200); const consent = await begin.json();
      const callback = await http(`/api/integrations/amazon/sp-api/oauth/callback?${new URLSearchParams({ state: new URL(consent.consentUrl).searchParams.get("state")!, selling_partner_id: "PROCESSFIXTURE1", spapi_oauth_code: "fixture-process-renewal" })}`, { headers: { cookie }, redirect: "manual" });
      assert.equal(callback.status, 303);
      const renewed = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: auth.id } });
      assert.equal(renewed.status, "CONFIGURED"); assert.ok(renewed.revision > auth.revision);
      assert.equal(await prisma.amazonSyncDataSource.count({ where: scope }), 17);
      assert.equal(await prisma.amazonSyncSchedule.count({ where: { ...scope, executionVersion: 2 } }), 17);
      evidence.push({ scenario: "authorization expiry and HTTP OAuth renewal", expiredRequests: 0, sources: 17, plans: 17, authorizationRevisionAdvanced: true });
    });
    await t.test("account revocation rejects all three real HTTP entries", async () => {
      await prisma.amazonDataAccessGrant.updateMany({ where: { ...scope, userId: actor, sellerAccountId: source.sellerAccountId }, data: { enabled: false, revision: { increment: 1 } } });
      const args = { table: "inventory", sellerAccountId: source.sellerAccountId, marketplaceId: site };
      const erp = await http(`/api/operations/sync-center?${new URLSearchParams({ section: "data", ...args })}`, { headers: { cookie } });
      const lili = await http("/api/lili/tools/run", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ name: "erp__data_query", input: args }) });
      assert.equal(erp.status, 403); assert.ok([403, 409].includes(lili.status), await lili.text());
      const mcp = await http("/api/mcp/amazon", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "data_query", arguments: args } }) });
      const denied = await mcp.json();
      assert.ok(mcp.status === 403 || denied.error || denied.result?.isError, JSON.stringify(denied));
      evidence.push({ scenario: "ERP/MCP/Lili grant revocation", erpStatus: erp.status, liliStatus: lili.status, mcpDenied: true });
    });
  } finally {
    for (const child of children.reverse()) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM"); await Promise.race([new Promise(resolve => child.once("exit", resolve)), pause(26000)]);
      }
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* Only this fixture process group. */ }
    }
    held?.destroy(); mocked.closeAllConnections(); await new Promise<void>(resolve => mocked.close(() => resolve()));
    const finalTasks = await prisma.amazonSyncRun.findMany({ where: scope, select: { id: true, resource: true, status: true, stage: true, attempts: true, pagesCompleted: true, insertedCount: true, apiRequests: true, throttles: true } });
    await getAmazonSyncQueue().disconnect(); await getAmazonSyncQueue().close(); await prisma.$disconnect();
    const currentTypes = await readFile("next-env.d.ts", "utf8");
    const restored = restoreNextEnvironment(currentTypes, beforeTypes, dist);
    if (restored !== currentTypes) await writeFile("next-env.d.ts", restored);
    const currentConfig = await readFile("tsconfig.json", "utf8");
    const config = JSON.parse(currentConfig);
    config.include = config.include.filter((entry: string) => entry !== `${dist}/types/**/*.ts`);
    if (JSON.stringify(config) !== JSON.stringify(JSON.parse(currentConfig))) await writeFile("tsconfig.json", JSON.stringify(config, null, 2) + "\n");
    await writeFile(path.join(directory, "process.log"), logs.join(""));
    await writeFile("docs/acceptance/sp-api-process-lifecycle-2026-11-10.json", JSON.stringify({ environment: "disposable PostgreSQL/Redis, actual registered Worker, real local Next HTTP; mocked Amazon only",
      status: evidence.length === 12 ? "SCENARIOS_PASSED" : "FAILED_OR_INCOMPLETE", fullRequestedLifecycleAccepted: false, notCovered: ["parser failure recovery", "late corrections outside latest closed day", "all adapters and optional policy combinations"], finalTasks, evidence, realAmazonRequests: 0, productionOperations: false, fixtureLog: directory }, null, 2) + "\n");
    console.log(`Process fixture logs: ${directory}`);
    await rm(clock, { force: true });
    await rm(path.resolve(dist), { recursive: true, force: true });
  }
});
