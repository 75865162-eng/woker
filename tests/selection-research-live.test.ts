import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { callSellerSpriteRemoteTool, listSellerSpriteRemoteTools, defaultSellerSpriteMcpSettings } from "../src/lib/integrations/sellersprite";
import { ResearchEngine, budgetSummary } from "../src/lib/selection-research/engine";
import { LocalResearchStore } from "../src/lib/selection-research/file-store";
import { sellerSpritePolicy, createSellerSpriteResearchTransport } from "../src/lib/selection-research/seller-transport";
import { SKILLS, type Agent, type ToolDefinition, type ObjectJson } from "../src/lib/selection-research/types";
import { createResearchAiAgent } from "../src/lib/selection-research/ai-agent";
import { defaultAiModelSettings } from "../src/lib/ai-settings";

const settings = { ...defaultSellerSpriteMcpSettings, enabled: true, serverUrl: "https://seller.invalid/mcp", apiKey: "isolated-secret-key" };
const schema = { type: "object", properties: { market: { type: "string" } }, required: ["market"], additionalProperties: false } as const;
const tool: ToolDefinition = { name: "product_research", inputSchema: structuredClone(schema) as never };

test("AI adapter uses ERP model protocol with credentials only in headers and runtime schema in the prompt", async () => {
  const context = { instructions: "isolated instructions", tools: [tool], skill: { name: "isolated" }, run: { requirement: "isolated requirement" } } as never;
  for (const wireApi of ["chat_completions", "responses"] as const) {
    const agent = createResearchAiAgent({ ...defaultAiModelSettings, wireApi, apiKey: "isolated-ai-secret", baseUrl: "https://model.invalid/v1", model: "isolated-model" }, async (url, init) => {
      assert.match(url, wireApi === "responses" ? /\/responses$/ : /\/chat\/completions$/);
      assert.equal(new Headers(init.headers as HeadersInit).get("authorization"), "Bearer isolated-ai-secret");
      const body = String(init.body);
      assert.ok(!body.includes("isolated-ai-secret")); assert.match(body, /product_research/); assert.match(body, /inputSchema/);
      const action = JSON.stringify({ type: "call", tool: "product_research", arguments: { market: "US" } });
      return Response.json(wireApi === "responses" ? { output_text: action } : { choices: [{ message: { content: action } }] });
    });
    assert.deepEqual(await agent.next(context), { type: "call", tool: "product_research", arguments: { market: "US" } });
  }
});

test("SellerSprite runtime discovery follows sessions/pages, exact schema and full matching SSE envelope without network", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let sessions = 0;
  const envelopes: unknown[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    assert.equal(init?.redirect, "error");
    assert.equal(headers.get("authorization"), `Bearer ${settings.apiKey}`);
    if (body.method === "initialize") {
      sessions++;
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } }, { headers: { "mcp-session-id": "isolated-session" } });
    }
    assert.equal(headers.get("mcp-session-id"), "isolated-session");
    assert.equal(headers.get("mcp-protocol-version"), "2025-06-18");
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    let result: unknown;
    if (body.method === "tools/list") result = body.params.cursor ? { tools: [{ name: "review", inputSchema: schema }] } : { tools: [tool], nextCursor: "page2" };
    else {
      assert.equal(body.method, "tools/call");
      assert.deepEqual(body.params, { name: "product_research", arguments: { market: "US" } });
      calls++;
      result = { content: [{ type: "text", text: JSON.stringify({ records: [], query: "isolated protocol verification" }) }] };
    }
    const envelope = { jsonrpc: "2.0", id: body.id, result };
    envelopes.push(envelope);
    return new Response(`data: ${JSON.stringify(envelope)}\n\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  try {
    assert.deepEqual((await listSellerSpriteRemoteTools(settings)).map((item) => item.name), ["product_research", "review"]);
    const raw = await callSellerSpriteRemoteTool(settings, tool.name, { market: "US" }, new AbortController().signal, tool.inputSchema);
    assert.deepEqual(raw, envelopes.at(-1));
    assert.equal(calls, 1); assert.equal(sessions, 2);
    await assert.rejects(callSellerSpriteRemoteTool(settings, tool.name, { market: "US" }, new AbortController().signal, { type: "object" }), /SCHEMA_CHANGED/);
    assert.equal(calls, 1);
    await assert.rejects(listSellerSpriteRemoteTools({ ...settings, serverUrl: "http://seller.invalid/mcp" }), /ENDPOINT_UNSAFE/);
    globalThis.fetch = async () => Response.json({ result: settings.apiKey });
    await assert.rejects(listSellerSpriteRemoteTools(settings), /SECRET_ECHO/);
  } finally { globalThis.fetch = original; }
});

test("live engine persists immutable approval, blocks changed schema, accounts calls and restores without fixture fallback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "selection-live-isolated-"));
  try {
    const store = new LocalResearchStore(root);
    const scope = { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" };
    let dispatches = 0;
    let changed = false;
    const transport = {
      async listTools() { return [{ ...tool, inputSchema: changed ? { type: "object", properties: {} } : tool.inputSchema }]; },
      async callTool() { dispatches++; return { result: { content: [{ type: "text", text: "isolated successful response" }] } }; },
    };
    const agent: Agent = { async next(context) {
      assert.equal(context.tools[0]?.name, "product_research");
      const args: ObjectJson = changed ? {} : { market: "US" };
      return { type: "call", tool: "product_research", arguments: args };
    } };
    const engine = () => new ResearchEngine(store, scope, transport, agent, { mode: "live", authorizeLive: async () => true });
    const policy = sellerSpritePolicy(tool)!;
    const run = await engine().create({ requirement: "isolated live branch verification", marketplace: "US", skills: SKILLS.map((name) => ({ name, path: "isolated", sha256: "isolated", markdown: "isolated", tools: [] })), policies: { [tool.name]: policy }, limits: { sellersprite: 1 } });
    let state = await engine().step(run.id);
    assert.equal(state.gate?.kind, "MCP_CALL"); assert.equal(dispatches, 0);
    await assert.rejects(engine().decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: state.gate!.id, callId: "wrong" }), /MISMATCH/);
    state = await engine().decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: state.gate!.id, callId: state.pendingActionId });
    state = await engine().step(run.id);
    assert.equal(dispatches, 1); assert.equal(state.gate?.kind, "BILLING"); assert.ok(state.calls[0].rawResponse);
    assert.equal(state.calls[0].service, "sellersprite");
    state = await engine().decide(run.id, { kind: "RECONCILE", gateId: state.gate!.id, callId: state.calls[0].id, units: 99, receipt: "isolated receipt" });
    assert.equal(budgetSummary(state).sellersprite.committed, 1); // Calls are never represented as credits.
    assert.equal(state.calls[0].knownUnits, 99);
    state = await engine().step(run.id);
    state = await engine().decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: state.gate!.id, callId: state.pendingActionId });
    changed = true;
    state = await engine().step(run.id);
    assert.equal(state.status, "FAILED"); assert.equal(dispatches, 1);
    assert.equal(state.failure, "APPROVED_SCHEMA_CHANGED");
    state = await engine().recover(run.id);
    assert.equal(state.pendingActionApproved, undefined); assert.equal(state.pendingAction, undefined);
    state = await engine().step(run.id);
    assert.equal(state.gate?.kind, "MCP_CALL"); assert.deepEqual(state.pendingAction?.arguments, {});
    assert.equal(dispatches, 1); // New schema must be reviewed again, not replayed under the earlier approval.
    assert.equal(sellerSpritePolicy({ name: "market_query_xiyou" }), null);
    assert.equal(sellerSpritePolicy({ name: "data_query" }), null);
    assert.ok(createSellerSpriteResearchTransport(settings));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("engine records actionable host error codes without persisting untrusted exception details", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "selection-errors-isolated-"));
  try {
    for (const message of ["RESEARCH_AI_REQUEST_FAILED", "RESEARCH_AI_REQUEST_FAILED Bearer isolated-private-secret"]) {
      const store = new LocalResearchStore(root);
      const engine = new ResearchEngine(store, { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" }, { async listTools() { return []; }, async callTool() { throw new Error("unreachable"); } }, { async next() { throw new Error(message); } }, { mode: "fixture" });
      const run = await engine.create({ requirement: "Isolated error handling verification", marketplace: "US", policies: {}, limits: {}, skills: SKILLS.map(name => ({ name, path: "isolated", sha256: "isolated", markdown: "isolated", tools: [] })) });
      const failed = await engine.step(run.id);
      assert.equal(failed.status, "FAILED");
      assert.equal(failed.failure, message === "RESEARCH_AI_REQUEST_FAILED" ? message : "RESEARCH_STEP_FAILED_REVIEW_CONTEXT");
      assert.ok(!JSON.stringify(await engine.inspect(run.id)).includes("isolated-private-secret"));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("untrusted transport errors cannot attest non-dispatch or release paid and legacy reservations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "selection-unknown-isolated-"));
  try {
    for (const failure of [new Error("RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN"), Object.assign(new Error("APPROVED_SCHEMA_CHANGED"), { name: "ToolNotDispatchedError", code: "APPROVED_SCHEMA_CHANGED" })]) {
      const engine = new ResearchEngine(new LocalResearchStore(root), { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" }, {
        async listTools() { return [tool]; }, async callTool() { throw failure; },
      }, { async next() { return { type: "call", tool: tool.name, arguments: { market: "US" } }; } }, { mode: "live", authorizeLive: async () => true });
      let run = await engine.create({ requirement: "Isolated unknown dispatch verification", marketplace: "US", policies: { [tool.name]: sellerSpritePolicy(tool)! }, limits: { sellersprite: 1 }, skills: SKILLS.map(name => ({ name, path: "isolated", sha256: "isolated", markdown: "isolated", tools: [] })) });
      run = await engine.step(run.id);
      run = await engine.decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: run.gate!.id, callId: run.pendingActionId });
      run = await engine.step(run.id);
      assert.equal(run.calls[0].dispatch, "ATTEMPTED");
      assert.equal(run.calls[0].status, "UNKNOWN");
      assert.equal(run.gate?.kind, "BILLING");
      assert.deepEqual(budgetSummary(run).sellersprite, { limit: 1, committed: 1, unknownCalls: 1 });
      delete run.calls[0].dispatch; // Older persisted runs do not carry the new field.
      assert.deepEqual(budgetSummary(run).sellersprite, { limit: 1, committed: 1, unknownCalls: 1 });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
