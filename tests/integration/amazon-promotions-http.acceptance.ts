import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, scryptSync } from "node:crypto";
import { createServer } from "node:http";
import net from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { prisma } from "@/lib/db/prisma";
import { manageMcpCredential } from "@/lib/amazon-sync/mcp";
import { createLiliTransport } from "@/lib/selection-research/lili-transport";
import { validate } from "@/lib/selection-research/schema";
import type { ObjectJson } from "@/lib/selection-research/types";
import type { fresh } from "./amazon-promotions.integration";
import Ajv from "ajv";

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
type Envelope = { result?: { content: Array<{ type: string; text: string }>; isError?: boolean; structuredContent?: unknown }; error?: unknown };
function output(envelope: unknown): Record<string, unknown> {
  const rpc = envelope as Envelope; assert.ok(!rpc.error, JSON.stringify(rpc)); assert.equal(rpc.result?.isError, false, JSON.stringify(rpc));
  return JSON.parse(rpc.result!.content[0].text);
}

export function registerPromotionsHttpAcceptance(make: typeof fresh) {
  test("Promotions actual HTTP MCP and authenticated Lili client acceptance", { timeout: 300000 }, async t => {
    assert.equal(process.env.AMAZON_SYNC_OFFLINE_FIXTURE, "1");
    const f = await make("promotions"); f.setMode("http-pagination"); const original = await f.start(); assert.equal((await f.finish(original.id)).status, "SUCCEEDED");
    const site = "ATVPDKIKX0DER", pair = { sellerAccountId: f.sellerAccountId, marketplaceId: site };
    const tools = ["promotions_search", "promotions_get", "promotions_get_items"];
    const tables = ["promotions", "promotion_details", "promotion_items"];
    const directory = await mkdtemp(path.join(tmpdir(), "promotions-http-")), clock = path.join(directory, "clock");
    const dist = ".next-promotions-http-" + randomUUID().slice(0, 8), port = await freePort(), base = "http://127.0.0.1:" + port;
    const evidence: Array<Record<string, unknown>> = [], logs: string[] = [];
    let child: ChildProcess | undefined, forbiddenAmazonRequests = 0;
    const blocked = createServer((_request, response) => { forbiddenAmazonRequests++; response.writeHead(502).end("Amazon calls forbidden in read acceptance"); });
    await new Promise<void>(resolve => blocked.listen(0, "127.0.0.1", resolve));
    await writeFile(clock, "0");
    const http = (url: string, init: RequestInit = {}) => fetch(base + url, { ...init, signal: AbortSignal.timeout(60000) });
    const credential = await manageMcpCredential(f.scope, f.actor, { action: "create", name: "HTTP fixture", scopes: [{ sellerAccountId: f.sellerAccountId, marketplaceIds: [site] }], tools: [], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    assert.ok(credential.token);
    let cookie = "";
    const rpc = async (endpoint: string, method: string, params: unknown = {}, bearer = false) => {
      const response = await http(endpoint, { method: "POST", headers: { "content-type": "application/json", "mcp-protocol-version": "2025-06-18", ...(bearer ? { authorization: "Bearer " + credential.token! } : { cookie }) }, body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }) });
      return { status: response.status, body: await response.json() };
    };
    const requestArgs = (index: number, page = 1): ObjectJson => ({ ...pair, ...(index ? { promotionId: "promo-one" } : {}), page, pageSize: 1 });
    try {
      await prisma.user.update({ where: { id: f.actor }, data: { passwordHash: "scrypt:fixture:" + scryptSync("fixture-password", "fixture", 64).toString("base64url") } });
      const env: NodeJS.ProcessEnv = { ...process.env, ERP_RUNTIME_MODE: "production", NODE_ENV: "development", QUEUE_DRIVER: "redis", NEXT_TELEMETRY_DISABLED: "1", AMAZON_API_EXECUTION_ROLE: "local", AMAZON_SYNC_PROCESS_FIXTURE: "1",
        AMAZON_SYNC_FIXTURE_HTTP: "http://127.0.0.1:" + (blocked.address() as net.AddressInfo).port, AMAZON_SYNC_FIXTURE_CLOCK: clock, AMAZON_SYNC_FIXTURE_KEY: "fixture-read-only", AMAZON_SYNC_FIXTURE_WEB_PORT: String(port),
        NODE_OPTIONS: "--import=" + pathToFileURL(path.resolve("tests/helpers/amazon-process-preload.mjs")).href };
      child = spawn(process.execPath, ["scripts/next-run.mjs", dist, "dev", "--turbopack", "--hostname", "127.0.0.1", "--port", String(port)], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout!.on("data", value => logs.push(String(value))); child.stderr!.on("data", value => logs.push(String(value)));
      let ready = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        if (child.exitCode !== null) throw Error("Fixture web exited: " + logs.join("").slice(-4000));
        try { if ((await http("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status === 400) { ready = true; break; } } catch { /* Only this disposable port. */ }
        await pause(250);
      }
      assert.ok(ready, logs.join("").slice(-5000));
      const login = await http("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: f.actor + "@fixture.invalid", password: "fixture-password" }) });
      assert.equal(login.status, 200, await login.clone().text()); cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert.ok(cookie);
      // Use the shipped real HTTP MCP client, including initialize/initialized,
      // protocol negotiation and tools/list. No injected handler/registry transport.
      const native = createLiliTransport({ endpoint: base + "/api/mcp/amazon", authorization: "Bearer " + credential.token, timeoutMs: 60000 });
      const lili = createLiliTransport({ endpoint: base + "/api/lili/mcp", timeoutMs: 60000, fetch: (url, init) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), cookie, "x-workspace-id": "fixture" } }) });
      await t.test("connected HTTP clients discover actual schemas and read-only registrations", async () => {
        const a = await native.listTools(new AbortController().signal), b = await lili.listTools(new AbortController().signal);
        for (let index = 0; index < tools.length; index++) {
          const tool = a.find(row => row.name === tools[index]), registered = b.find(row => row.name === "erp__" + tools[index]);
          assert.ok(tool, tools[index]); assert.ok(registered, "Lili " + tools[index]);
          assert.deepEqual(registered.inputSchema, tool.inputSchema); assert.equal(tool.inputSchema.additionalProperties, false);
          assert.ok((tool.inputSchema.required as string[]).includes("sellerAccountId")); assert.ok((tool.inputSchema.required as string[]).includes("marketplaceId"));
          if (index) assert.ok((tool.inputSchema.required as string[]).includes("promotionId"));
          assert.ok((tool as unknown as { outputSchema: ObjectJson }).outputSchema); assert.deepEqual((registered as unknown as { outputSchema: ObjectJson }).outputSchema, (tool as unknown as { outputSchema: ObjectJson }).outputSchema); assert.equal(tool.annotations?.readOnlyHint, true);
          validate(tool.inputSchema, requestArgs(index));
        }
        const directoryResponse = await http("/api/lili/mcp?workspaceId=fixture", { headers: { cookie } }); const catalog = await directoryResponse.json();
        assert.equal(catalog.source, "runtime-registry"); assert.equal(catalog.scope, "authenticated-ERP-session");
        assert.ok(catalog.providers.some((provider: { provider: string; status: string }) => provider.provider === "erp" && provider.status === "connected"));
        evidence.push({ scenario: "client_initialize_and_actual_registry", mcp: tools, lili: tools.map(name => "erp__" + name), schemaValidated: true, client: "shipped createLiliTransport over HTTP" });
      });
      await t.test("all tools/pages equal ERP unified queries without any upstream reads", async () => {
        const registry = await native.listTools(new AbortController().signal);
        const schemas = new Ajv({ allErrors: true });
        for (let index = 0; index < tools.length; index++) for (const page of [1, 2]) {
          const args = requestArgs(index, page), params = new URLSearchParams({ section: "data", table: tables[index], workspaceId: "fixture", ...Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)])) });
          const erp = await http("/api/operations/sync-center?" + params, { headers: { cookie } }); assert.equal(erp.status, 200, await erp.clone().text()); const data = await erp.json();
          const a = output(await native.callTool(tools[index], args, new AbortController().signal));
          const b = output(await lili.callTool("erp__" + tools[index], args, new AbortController().signal));
          const schema = (registry.find(row => row.name === tools[index])! as unknown as { outputSchema: ObjectJson }).outputSchema;
          assert.ok(schemas.validate(schema, a), JSON.stringify(schemas.errors));
          assert.ok(Array.isArray((a.data as { items: unknown }).items)); assert.equal(typeof (a.data as { total: unknown }).total, "number");
          assert.deepEqual(a.data, data.data); assert.deepEqual(b.data, data.data); assert.deepEqual(a.pagination, b.pagination);
          assert.equal((a.pagination as { page: number }).page, page);
          if (index === 2) { assert.equal((a.data as { total: number }).total, 2); assert.equal(((a.data as { items: unknown[] }).items).length, 1); assert.equal((a.pagination as { hasNext: boolean }).hasNext, page === 1); }
          const encoded = JSON.stringify([data, a, b]);
          for (const secret of [credential.token!, cookie, "credentialsCiphertext", "refreshToken", "access_token", "fixture-only-isolated-integration-secret-2026"]) assert.ok(!encoded.includes(secret), secret.slice(0, 12));
        }
        assert.equal(forbiddenAmazonRequests, 0); evidence.push({ scenario: "all_three_tools_erp_mcp_lili_equivalence", pages: [1, 2], upstreamCalls: 0 });
      });
      await t.test("foreign account/site and forged userId never bypass current ERP identity", async () => {
        for (let index = 0; index < tools.length; index++) for (const changed of [{ sellerAccountId: randomUUID() }, { marketplaceId: "A2EUQ1WTGCTBG2" }, { userId: f.approver }]) {
          const args = { ...requestArgs(index), ...changed };
          const a = await rpc("/api/mcp/amazon", "tools/call", { name: tools[index], arguments: args }, true);
          const b = await rpc("/api/lili/mcp", "tools/call", { name: "erp__" + tools[index], arguments: args });
          assert.ok(a.status >= 400 || a.body.error || a.body.result?.isError, JSON.stringify(a));
          assert.ok(b.status >= 400 || b.body.error || b.body.result?.isError, JSON.stringify(b));
        }
        const anonymous = await http("/api/lili/mcp"); const listed = await anonymous.json(); assert.ok(listed.tools.every((row: { name: string }) => !row.name.startsWith("erp__")));
        evidence.push({ scenario: "account_marketplace_identity_forgery", denied: 18, anonymousErpTools: 0 });
      });
      await t.test("constraint migration reapplication preserves published data and uniqueness", async () => {
        const before = await prisma.amazonDomainObservation.findMany({ where: { sourceRunId: original.id }, orderBy: { id: "asc" } });
        const config = process.env.AMAZON_PROMOTIONS_MIGRATION_CONFIG; assert.ok(config);
        for (let repeat = 0; repeat < 2; repeat++) {
          const migration = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", config], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
          let result = ""; migration.stdout!.on("data", value => { result += String(value); }); migration.stderr!.on("data", value => { result += String(value); });
          const code = await new Promise(resolve => migration.once("exit", resolve)); assert.equal(code, 0, result); assert.match(result, /No pending migrations/);
        }
        assert.deepEqual(await prisma.amazonDomainObservation.findMany({ where: { sourceRunId: original.id }, orderBy: { id: "asc" } }), before);
        await assert.rejects(() => prisma.amazonDomainObservation.create({ data: { ...before[0], id: randomUUID(), facts: before[0].facts as import("@prisma/client").Prisma.InputJsonValue } }), /unique|constraint/i);
        const count = before.length; await f.slice(original.id); assert.equal(await prisma.amazonDomainObservation.count({ where: { sourceRunId: original.id } }), count);
        // A completed older task is delivered after a newer publication.
        const newer = await f.start(); assert.equal((await f.finish(newer.id)).status, "SUCCEEDED"); await f.slice(original.id);
        assert.equal((await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId } })).activeRunId, newer.id);
        evidence.push({ scenario: "migration_reapply_with_promotions", passes: 2, preservedRows: count, uniqueConstraint: true, repeatedPublication: true, staleTaskCannotReplaceHead: true });
      });
      await t.test("empty published, unsynced, failed and blocked states stay distinct", async () => {
        const head = await prisma.amazonSyncDataSource.findUniqueOrThrow({ where: { id: f.sourceId } });
        const latest = await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: head.activeRunId! } });
        const statuses: Record<string, unknown> = {};
        const empty = output(await native.callTool("promotions_search", { ...pair, promotionId: "not-present" }, new AbortController().signal));
        assert.equal((empty.data as { total: number }).total, 0); assert.equal((empty.meta as { resultStatus: string }).resultStatus, "EMPTY_RESULT");
        try {
          await prisma.amazonSyncDataSource.update({ where: { id: f.sourceId }, data: { activeRunId: null, lastSuccessAt: null, rowCount: 0 } });
          const unpublished = await rpc("/api/mcp/amazon", "tools/call", { name: "promotions_search", arguments: pair }, true);
          assert.equal(unpublished.body.error?.data?.businessCode, "DATASET_UNPUBLISHED");
          for (const status of ["WAITING", "FAILED", "BLOCKED"]) {
            await prisma.amazonSyncRun.update({ where: { id: latest.id }, data: { status, finishedAt: status === "WAITING" ? null : new Date() } });
            const result = output(await native.callTool("data_sync_status", pair, new AbortController().signal));
            const row = (result.data as { items: Array<{ resource: string; latestTask: { status: string } }> }).items.find(row => row.resource === "promotions")!;
            assert.equal(row.latestTask.status, status); statuses[status] = row.latestTask.status;
            const liliStatus = output(await lili.callTool("erp__data_sync_status", pair, new AbortController().signal)); assert.deepEqual((liliStatus.data as { items: unknown }).items, (result.data as { items: unknown }).items);
          }
        } finally {
          await prisma.amazonSyncRun.update({ where: { id: latest.id }, data: { status: latest.status, finishedAt: latest.finishedAt } });
          await prisma.amazonSyncDataSource.update({ where: { id: f.sourceId }, data: { activeRunId: head.activeRunId, lastSuccessAt: head.lastSuccessAt, rowCount: head.rowCount } });
        }
        evidence.push({ scenario: "availability_states", empty: "EMPTY_RESULT", noPublication: "DATASET_UNPUBLISHED", taskStates: statuses, qualificationLimitation: "BLOCKED is not proof of actual Amazon ineligibility" });
      });
      await t.test("complete empty publication differs from never-synced source over HTTP", async () => {
        const empty = await make("promotions"); empty.setMode("no-longer-returned");
        const run = await empty.start(); assert.equal((await empty.finish(run.id)).status, "SUCCEEDED");
        const never = await make("promotions");
        for (const fixture of [empty, never]) {
          const scope = { sellerAccountId: fixture.sellerAccountId, marketplaceId: site };
          const made = await manageMcpCredential(fixture.scope, fixture.actor, { action: "create", name: "availability HTTP fixture", scopes: [{ sellerAccountId: fixture.sellerAccountId, marketplaceIds: [site] }], tools: [], expiresAt: new Date(Date.now() + 60000).toISOString() });
          const client = createLiliTransport({ endpoint: base + "/api/mcp/amazon", authorization: "Bearer " + made.token });
          if (fixture === empty) {
            const result = output(await client.callTool("promotions_search", scope, new AbortController().signal));
            assert.equal((result.data as { total: number }).total, 0); assert.equal((result.meta as { resultStatus: string }).resultStatus, "EMPTY_RESULT");
            assert.ok((result.meta as { sources: Array<{ syncRunId: string }> }).sources.some(source => source.syncRunId === run.id));
          } else {
            await assert.rejects(async () => output(await client.callTool("promotions_search", scope, new AbortController().signal)));
            const status = output(await client.callTool("data_sync_status", scope, new AbortController().signal));
            const promotion = (status.data as { items: Array<{ resource: string; latestTask: unknown; syncRunId: unknown }> }).items.find(row => row.resource === "promotions")!;
            assert.equal(promotion.latestTask, null); assert.equal(promotion.syncRunId, null);
          }
        }
        evidence.push({ scenario: "empty_published_vs_never_synced", successfulEmptyPublication: run.id, emptyRows: 0, neverSyncedLatestTask: null, neverSyncedHead: null });
      });
      await t.test("same connected clients reject account revocation immediately", async () => {
        const requests = f.calls.length;
        await prisma.amazonDataAccessGrant.updateMany({ where: { ...f.scope, userId: f.actor, sellerAccountId: f.sellerAccountId }, data: { enabled: false, revision: { increment: 1 } } });
        for (let index = 0; index < tools.length; index++) {
          await assert.rejects(async () => output(await native.callTool(tools[index], requestArgs(index), new AbortController().signal)));
          await assert.rejects(async () => output(await lili.callTool("erp__" + tools[index], requestArgs(index), new AbortController().signal)));
        }
        const noLongerVisible = async (client: typeof native) => {
          try { return await client.listTools(new AbortController().signal); }
          catch (error) { assert.match(String(error), /LILI_HTTP_40[13]/); return []; }
        };
        const a = await noLongerVisible(native), b = await noLongerVisible(lili);
        assert.ok(a.every(tool => !tools.includes(tool.name))); assert.ok(b.every(tool => !tools.some(name => tool.name === "erp__" + name)));
        assert.equal(f.calls.length, requests); assert.equal(forbiddenAmazonRequests, 0);
        evidence.push({ scenario: "live_revocation_same_clients", deniedCalls: 6, removedFromBothRegistries: true, amazonCalls: 0 });
      });
    } finally {
      if (child?.pid) { child.kill("SIGTERM"); await Promise.race([new Promise(resolve => child!.once("exit", resolve)), pause(5000)]); try { process.kill(-child.pid, "SIGKILL"); } catch { /* Only own process group. */ } }
      blocked.closeAllConnections(); await new Promise<void>(resolve => blocked.close(() => resolve()));
      await writeFile(path.join(directory, "web.log"), logs.join(""));
      const record = { environment: "disposable PostgreSQL/Redis; real Next HTTP; shipped HTTP client; actual ERP login", passedScenarios: evidence.length, expectedScenarios: 7, status: evidence.length === 7 ? "PASSED" : "FAILED_OR_INCOMPLETE", evidence, realAmazonRequests: 0, forbiddenAmazonRequests, localFormalExecutorStarted: false, deployed: false, codexDesktopConnectorInstalled: false, fixtureLog: directory };
      const destination = process.env.AMAZON_PROMOTIONS_HTTP_EVIDENCE;
      if (destination) await writeFile(destination, JSON.stringify(record, null, 2) + "\n");
      console.log("PROMOTIONS_HTTP_ACCEPTANCE " + JSON.stringify(record));
      await rm(path.resolve(dist), { recursive: true, force: true }); await rm(clock, { force: true });
    }
  });
}
