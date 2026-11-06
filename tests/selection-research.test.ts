import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { LocalResearchStore } from "../src/lib/selection-research/file-store";
import { ResearchEngine, budgetSummary } from "../src/lib/selection-research/engine";
import { LeaseResearchStore, type ResearchRepository, type ResearchRow } from "../src/lib/selection-research/lease-store";
import { loadResearchSkills } from "../src/lib/selection-research/skills";
import { researchFixture } from "../src/lib/selection-research/fixture";
import { renderResearchReport } from "../src/lib/selection-research/report";
import { createLiliTransport, parseRpc } from "../src/lib/selection-research/lili-transport";
import { validate, rejectCredentials } from "../src/lib/selection-research/schema";
import { calculateUnitEconomics } from "../src/lib/selection-research/economics";
import { executeResearchCommand } from "../src/lib/selection-research/http";
import { SKILLS, type Agent, type Scope, type SkillSnapshot } from "../src/lib/selection-research/types";

const scope: Scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace", ownerId: "fixture-owner" };
const skills: SkillSnapshot[] = SKILLS.map((name) => ({ name, path: `fixture/${name}/SKILL.md`, markdown: "isolated fixture", sha256: createHash("sha256").update("isolated fixture").digest("hex"), tools: [] }));
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "selection-research-test-"));
  const store = new LocalResearchStore(root);
  const fixture = researchFixture();
  const engine = new ResearchEngine(store, scope, fixture.transport, fixture.agent, { mode: "fixture" });
  const run = await engine.create({ requirement: "隔离测试，不研究真实市场", marketplace: "US", skills, policies: fixture.policies, limits: {} });
  return { root, store, fixture, engine, run };
}
async function drive(engine: ResearchEngine, id: string) {
  let run = await engine.inspect(id);
  for (let i = 0; i < 30 && ["CREATED", "RUNNING", "RESUMABLE"].includes(run.status); i++) run = await engine.step(id);
  return run;
}
async function completed(engine: ResearchEngine, id: string) {
  let run = await drive(engine, id);
  run = await engine.decide(id, { gateId: run.gate!.id, kind: "SELECT", candidateId: "fixture-2" });
  run = await drive(engine, id);
  return engine.decide(id, { gateId: run.gate!.id, kind: "CONFIRM" });
}

test("five stages survive a new engine, enforce both gates, persist raw evidence and decline unverified market decisions", async () => {
  const { root, store, fixture, engine, run } = await setup();
  try {
    const niche = await drive(engine, run.id);
    assert.equal(niche.gate?.kind, "NICHE"); assert.equal(niche.stage, 1);
    assert.equal((await engine.step(run.id)).revision, niche.revision);
    await assert.rejects(engine.decide(run.id, { kind: "CONFIRM", gateId: niche.gate!.id }), /DECISION/);
    assert.throws(() => renderResearchReport(niche), /REPORT_REQUIRES/);
    const resumed = new ResearchEngine(store, scope, fixture.transport, fixture.agent, { mode: "fixture" });
    await resumed.decide(run.id, { kind: "SELECT", candidateId: "fixture-1", gateId: niche.gate!.id });
    await assert.rejects(resumed.decide(run.id, { kind: "SELECT", candidateId: "fixture-1", gateId: niche.gate!.id }), /STALE/);
    const final = await drive(resumed, run.id);
    assert.equal(final.stage, 5); assert.equal(final.gate?.kind, "FINAL"); assert.equal(final.results[4].verdict, "NEEDS_VALIDATION");
    const done = await resumed.decide(run.id, { kind: "CONFIRM", gateId: final.gate!.id });
    assert.equal(done.status, "COMPLETED"); assert.equal(done.calls.length, 4); assert.equal(done.results.length, 5);
    assert.equal(done.decisions.length, 2); assert.ok(done.actions.length >= 9);
    assert.ok(done.calls.every((call) => call.rawResponse && call.inputSchema && call.respondedAt && call.retryCount === 0));
    let exports = 0;
    const persist = async () => { exports++; return "isolated-file-id"; };
    assert.equal((await resumed.saveReport(run.id, persist)).fileId, "isolated-file-id");
    assert.equal((await resumed.saveReport(run.id, persist)).fileId, "isolated-file-id");
    assert.equal(exports, 1);
    assert.equal((await resumed.inspect(run.id)).report?.fileId, "isolated-file-id");
    assert.match(await readFile(path.join(root, run.id, "state.json"), "utf8"), /isolated-fixture/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("auth scope and approval permission cannot be supplied through model input", async () => {
  const { root, store, fixture, engine, run } = await setup();
  try {
    for (const changed of [{ ownerId: "other" }, { organizationId: "other" }, { workspaceId: "other" }]) {
      const other = new ResearchEngine(store, { ...scope, ...changed }, fixture.transport, fixture.agent, { mode: "fixture" });
      await assert.rejects(other.inspect(run.id), /SCOPE_DENIED/);
      await assert.rejects(other.step(run.id), /SCOPE_DENIED/);
    }
    const waiting = await drive(engine, run.id);
    await assert.rejects(executeResearchCommand(engine, run.id, { operation: "decide", approvalAuthorized: true, decision: { kind: "SELECT", candidateId: "fixture-1", gateId: waiting.gate!.id } }, false), /PERMISSION/);
    assert.equal((await engine.inspect(run.id)).gate?.id, waiting.gate!.id);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("pre-dispatch budget reservation, uncertain billing and overage require distinct human decisions", async () => {
  const { root, store, fixture, engine, run } = await setup();
  let dispatches = 0;
  try {
    await store.transaction(run.id, async (state, save) => { state.policies.market_find_products = { ...state.policies.market_find_products, provider: "test-credits", paid: true, units: 2 }; state.limits["test-credits"] = 0; await save(); });
    const paid = new ResearchEngine(store, scope, { ...fixture.transport, async callTool(name, args, signal) {
      dispatches++;
      const checkpoint = await store.read(run.id);
      assert.equal(checkpoint.calls.at(-1)?.status, "IN_FLIGHT");
      return fixture.transport.callTool(name, args, signal);
    } }, fixture.agent, { mode: "fixture" });
    let state = await paid.step(run.id);
    assert.equal(state.gate?.kind, "BUDGET"); assert.equal(dispatches, 0);
    await paid.decide(run.id, { kind: "INCREASE_BUDGET", gateId: state.gate!.id, limits: { "test-credits": 2 } });
    state = await paid.step(run.id);
    assert.equal(state.gate?.kind, "BILLING"); assert.equal(dispatches, 1);
    assert.equal(budgetSummary(state)["test-credits"].committed, 2);
    await paid.step(run.id); assert.equal(dispatches, 1);
    state = await paid.decide(run.id, { kind: "RECONCILE", gateId: state.gate!.id, callId: state.calls[0].id, units: 3, receipt: "isolated test receipt" });
    assert.equal(state.gate?.kind, "BUDGET"); assert.equal(budgetSummary(state)["test-credits"].committed, 3);
    state = await paid.decide(run.id, { kind: "INCREASE_BUDGET", gateId: state.gate!.id, limits: { "test-credits": 3 } });
    assert.equal(state.status, "RESUMABLE"); assert.equal((await paid.step(run.id)).gate?.kind, "NICHE");
    assert.equal(dispatches, 1);
    assert.equal((await engine.inspect(run.id)).calls[0].knownUnits, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("process interruption and timeout never replay a potentially charged request", async () => {
  const { root, store, fixture, engine, run } = await setup();
  try {
    const timeout = new ResearchEngine(store, scope, { ...fixture.transport, async callTool() { return new Promise(() => {}); } }, fixture.agent, { mode: "fixture", timeoutMs: 5 });
    let state = await timeout.step(run.id);
    assert.equal(state.calls[0].status, "UNKNOWN"); assert.equal(state.gate?.kind, "BILLING");
    state = await engine.decide(run.id, { kind: "RECONCILE", gateId: state.gate!.id, callId: state.calls[0].id, units: 0, receipt: "local fixture no billing" });
    assert.equal(state.calls[0].status, "FAILED");
    state = await engine.step(run.id); // duplicate arguments are rejected rather than dispatched
    assert.equal(state.status, "FAILED"); assert.equal(state.calls.length, 1);
    await store.transaction(run.id, async (value, save) => { value.status = "RUNNING"; value.calls[0].status = "IN_FLIGHT"; await save(); });
    state = await engine.step(run.id);
    assert.equal(state.gate?.kind, "BILLING"); assert.equal(state.calls.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("missing tools, writes, unknown arguments and provider failure never become market evidence", async () => {
  const { root, store, fixture, engine, run } = await setup();
  try {
    let calls = 0;
    const transport = { async listTools() { return []; }, async callTool() { calls++; return {}; } };
    const missing = new ResearchEngine(store, scope, transport, fixture.agent, { mode: "fixture" });
    assert.equal((await missing.step(run.id)).status, "FAILED"); assert.equal(calls, 0);
    await engine.recover(run.id);
    const malicious: Agent = { async next() { return { type: "call", tool: "ads_create_campaign", arguments: {} }; } };
    assert.equal((await new ResearchEngine(store, scope, fixture.transport, malicious, { mode: "fixture" }).step(run.id)).status, "FAILED");
    await engine.recover(run.id);
    const failure = new ResearchEngine(store, scope, { ...fixture.transport, async callTool() { return { result: { content: [{ type: "text", text: '{"ok":false,"error":"provider_executor_unavailable"}' }] } }; } }, fixture.agent, { mode: "fixture" });
    const failed = await failure.step(run.id);
    assert.equal(failed.calls[0].status, "FAILED"); assert.equal(failed.status, "FAILED"); assert.ok(failed.calls[0].rawResponse);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("credential checks cover JSON inside MCP text blocks; schema subset rejects unknown or unsupported fields", () => {
  assert.throws(() => rejectCredentials({ content: [{ text: '{"apiKey":"do-not-save"}' }] }), /CREDENTIAL/);
  assert.throws(() => rejectCredentials({ url: "https://example.invalid?token=do-not-save" }), /CREDENTIAL/);
  assert.throws(() => validate({ type: "object", properties: {} }, { guessed: true }), /UNKNOWN/);
  assert.throws(() => validate({ oneOf: [] }, {}), /UNSUPPORTED/);
  assert.throws(() => validate({ type: "object", properties: { count: { type: "integer", minimum: 1 } } }, { count: 0 }), /RANGE/);
});

test("live mode cannot use an implicit approval or fall back to fixtures", async () => {
  const { root, store, fixture, run } = await setup();
  try {
    const live = new ResearchEngine(store, scope, fixture.transport, fixture.agent, { mode: "live" });
    await assert.rejects(live.step(run.id), /MODE_MISMATCH/);
    await store.transaction(run.id, async (state, save) => { state.mode = "live"; await save(); });
    await assert.rejects(live.step(run.id), /NOT_AUTHORIZED/);
    assert.equal((await store.read(run.id)).calls.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("HTML requires gates, escapes hostile data, embeds evidence and has no external assets or scripts", async () => {
  const { root, engine, run } = await setup();
  try {
    const done = await completed(engine, run.id);
    done.requirement = '<script src="https://evil.invalid/x.js">steal()</script>';
    const html = renderResearchReport(done);
    assert.match(html, /离线测试报告/); assert.match(html, /原始请求与响应/); assert.match(html, /&lt;script/);
    assert.doesNotMatch(html, /<script|(?:src|href)="https?:\/\//i); assert.doesNotMatch(html, /多宝鱼/);
    assert.match(html, /Content-Security-Policy/); assert.match(html, /<svg/); assert.match(html, /<details/);
    assert.throws(() => renderResearchReport(done, [{ evidenceId: "unknown", mime: "image/png", base64: "AAAA", alt: "x" }]), /IMAGE_EVIDENCE/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Skills are loaded verbatim and hashed without modification or server replacement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "research-skills-"));
  try {
    for (const name of SKILLS) { await mkdir(path.join(root, name)); await writeFile(path.join(root, name, "SKILL.md"), `# ${name}\n- \`market_get_asin\`\n`); }
    const loaded = await loadResearchSkills(root);
    assert.deepEqual(loaded.map((skill) => skill.name), [...SKILLS]);
    assert.ok(loaded.every((skill) => skill.tools[0] === "market_get_asin"));
    for (const skill of loaded) assert.equal(skill.markdown, await readFile(skill.path, "utf8"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP client follows real discovery pages and session, preserves full response, and blocks redirects/secrets", async () => {
  let pages = 0, call = false;
  const transport = createLiliTransport({ endpoint: "http://127.0.0.1:9999/api/mcp", authorization: "Bearer isolated-secret", fetch: async (_url, options) => {
    assert.equal(options?.redirect, "error");
    const body = JSON.parse(String(options?.body));
    if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } }, { headers: { "mcp-session-id": "fixture-session" } });
    assert.equal((options?.headers as Record<string, string>)["mcp-session-id"], "fixture-session");
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") { pages++; return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: `registered_${pages}`, inputSchema: { type: "object", properties: {} } }], ...(pages === 1 ? { nextCursor: "second" } : {}) } }); }
    call = true; return Response.json({ jsonrpc: "2.0", id: body.id, result: { isError: false, content: [{ type: "text", text: "raw fixture" }] } });
  } });
  assert.equal((await transport.listTools()).length, 2);
  const raw = await transport.callTool("registered_1", {}, new AbortController().signal);
  assert.equal((raw as { jsonrpc: string }).jsonrpc, "2.0"); assert.equal(call, true);
  assert.equal(parseRpc('event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":"x","result":{}}\n\n', "x").id, "x");
  assert.throws(() => createLiliTransport({ endpoint: "http://external.invalid/api/mcp" }), /UNSAFE/);
  assert.throws(() => createLiliTransport({ endpoint: "https://example.invalid/api/mcp?token=bad" }), /UNSAFE/);
});

test("durable leases serialize workers, recover expired owners and roll back rejected partial decisions", async () => {
  const { root, run } = await setup();
  try {
    let row: ResearchRow = { run: structuredClone(run), leaseId: null, leaseUntil: 0, version: "0" };
    const repository: ResearchRepository = { async create() {}, async read() { return structuredClone(row); }, async compareAndSet(_id, _scope, version, value) {
      if (version !== row.version) return null;
      row = { ...structuredClone(value), version: String(Number(row.version) + 1) }; return row.version;
    } };
    let now = 100;
    const store = new LeaseResearchStore(repository, scope, () => now);
    await store.transaction(run.id, async (state, save) => {
      await assert.rejects(store.transaction(run.id, async () => {}), /BUSY/);
      state.status = "RESUMABLE"; await save();
    });
    await assert.rejects(store.transaction(run.id, async (state) => { state.status = "COMPLETED"; throw new Error("rejected"); }), /rejected/);
    assert.equal((await store.read(run.id)).status, "RESUMABLE");
    row.leaseId = "crashed-worker"; row.leaseUntil = 150; now = 200;
    await store.transaction(run.id, async (state, save) => { state.status = "CANCELLED"; await save(); });
    assert.equal((await store.read(run.id)).status, "CANCELLED"); assert.equal(row.leaseId, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unit economics uses explicit per-unit costs and never supplies tax or fee defaults", () => {
  const input = { currency: "USD", price: 30, procurement: 5, internationalFreight: 2, importCharges: 1, referralFee: 4, fbaFee: 5, advertising: 3, storage: 1, returnsAllowance: 1 };
  const result = calculateUnitEconomics(input);
  assert.equal(result.landedCost, 8); assert.equal(result.profit, 8); assert.equal(result.margin, 8 / 30);
  assert.throws(() => calculateUnitEconomics({ ...input, importCharges: Number.NaN }), /EXPLICIT/);
});

test("historical tariff URLs cannot pass as verified current rates; missing review polarity blocks completion", async () => {
  const { root, store, fixture, engine, run } = await setup();
  try {
    await store.transaction(run.id, async (state, save) => { state.stage = 4; state.status = "RESUMABLE"; await save(); });
    const tariff: Agent = { async next() { return { type: "complete", result: { summary: "unverified historical rate", claims: [{ text: "historical rate", kind: "observed", evidenceIds: [], topic: "tariff", applicableDate: "2024-01-01", sourceUrl: "https://tariff.invalid" }] } }; } };
    assert.equal((await new ResearchEngine(store, scope, fixture.transport, tariff, { mode: "fixture" }).step(run.id)).status, "FAILED");
    await engine.recover(run.id);
    await store.transaction(run.id, async (state, save) => { state.stage = 3; await save(); });
    const noReviews: Agent = { async next() { return { type: "complete", result: { summary: "missing reviews", claims: [{ text: "pending", kind: "assumption", evidenceIds: [] }] } }; } };
    assert.equal((await new ResearchEngine(store, scope, fixture.transport, noReviews, { mode: "fixture" }).step(run.id)).status, "FAILED");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("secret echo is never persisted and uncertain response is not automatically retried", async () => {
  const { root, store, fixture, run } = await setup();
  try {
    const engine = new ResearchEngine(store, scope, { ...fixture.transport, async callTool() { return { content: [{ type: "text", text: '{"secretKey":"isolated-do-not-persist"}' }] }; } }, fixture.agent, { mode: "fixture" });
    const state = await engine.step(run.id);
    assert.equal(state.gate?.kind, "BILLING"); assert.equal(state.calls[0].status, "UNKNOWN");
    assert.equal(state.calls[0].rawResponse, undefined);
    assert.doesNotMatch(await readFile(path.join(root, run.id, "state.json"), "utf8"), /isolated-do-not-persist/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

