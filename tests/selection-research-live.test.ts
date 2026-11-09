import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { callSellerSpriteRemoteTool, listSellerSpriteRemoteTools, defaultSellerSpriteMcpSettings } from "../src/lib/integrations/sellersprite";
import { ResearchEngine, budgetSummary } from "../src/lib/selection-research/engine";
import { LocalResearchStore } from "../src/lib/selection-research/file-store";
import { sellerSpritePolicy, createSellerSpriteResearchTransport } from "../src/lib/selection-research/seller-transport";
import { SKILLS, ToolNotDispatchedError, type Agent, type ToolDefinition, type ObjectJson } from "../src/lib/selection-research/types";
import { createResearchAiAgent } from "../src/lib/selection-research/ai-agent";
import { defaultAiModelSettings } from "../src/lib/ai-settings";
import { executeResearchCommand } from "../src/lib/selection-research/http";

const settings = { ...defaultSellerSpriteMcpSettings, enabled: true, serverUrl: "https://seller.invalid/mcp", apiKey: "isolated-secret-key" };
const schema = { type: "object", properties: { market: { type: "string" } }, required: ["market"], additionalProperties: false } as const;
const tool: ToolDefinition = { name: "product_research", inputSchema: structuredClone(schema) as never };

test("encoded Codex arguments reach an immutable approval gate; invalid fields never dispatch", async () => {
 const root = await mkdtemp(path.join(tmpdir(), "research-native-input-"));
 let dispatched = 0;
 try {
  const engine = new ResearchEngine(new LocalResearchStore(root), { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" }, {
   async listTools() { return [tool]; }, async callTool() { dispatched++; return {}; },
  }, { async next() { throw new Error("Unexpected server model call"); } }, { mode: "live", authorizeLive: async () => true });
  const run = await engine.create({ executionMode: "codex", requirement: "Isolated native input verification。付费请求必须先批准。", marketplace: "US",
   skills: SKILLS.map(name => ({ name, path: "isolated", sha256: "isolated", markdown: "isolated", tools: [] })),
   policies: { [tool.name]: sellerSpritePolicy(tool)! }, limits: { sellersprite: 8 } });
  const command = (revision: number, args: unknown) => ({ operation: "step", expectedRevision: revision,
   action: { type: "call", tool: tool.name, arguments: args } });
  await assert.rejects(executeResearchCommand(engine, run.id, command(run.revision, "{broken"), false), /RESEARCH_ACTION_JSON_INVALID/);
  assert.equal((await engine.inspect(run.id)).revision, run.revision);
  let failed = await executeResearchCommand(engine, run.id, command(run.revision, '{"market":42}'), false);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failure, "RESEARCH_TOOL_ARGUMENTS_INVALID");
  assert.equal(failed.validationFeedback?.path, "$.market");
  assert.equal(failed.calls.length, 0);
  let recovered = await engine.recover(run.id);
  failed = await executeResearchCommand(engine, run.id, command(recovered.revision, { market: "US", isolatedPrivateField: "isolated-private-value" }), false);
  assert.equal(failed.failure, "RESEARCH_TOOL_ARGUMENTS_INVALID");
  assert.equal(failed.validationFeedback?.path, undefined); // Never echo arbitrary argument names in diagnostics.
  recovered = await engine.recover(run.id);
  const gate = await executeResearchCommand(engine, run.id, command(recovered.revision, '{"market":"US"}'), false);
  assert.equal(gate.gate?.kind, "MCP_CALL");
  assert.deepEqual(gate.pendingAction?.arguments, { market: "US" });
  assert.equal(gate.pendingActionApproved, false);
  assert.ok(gate.pendingActionId);
  const unchanged = await engine.step(run.id);
  assert.equal(unchanged.pendingActionId, gate.pendingActionId);
  assert.equal(unchanged.calls.length, 0);
  assert.equal(dispatched, 0);
 } finally { await rm(root, { recursive: true, force: true }); }
});

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

test("AI HTTP diagnostics preserve status only and never consume provider error details", async () => {
  const agent = createResearchAiAgent({ ...defaultAiModelSettings, apiKey: "isolated-secret" }, async () => ({
    ok: false, status: 401, headers: new Headers(),
    async json() { throw new Error("Must not read untrusted error body"); },
    async text() { throw new Error("Must not read untrusted error body"); },
    async arrayBuffer() { return new ArrayBuffer(0); },
  }));
  await assert.rejects(agent.next({ instructions: "isolated", tools: [], skill: { name: "isolated" }, run: {} } as never), /^Error: RESEARCH_AI_HTTP_401$/);
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

test("SellerSprite stops on the matching SSE event, tolerates schema key order and attests pre-dispatch failures", async () => {
  const original = globalThis.fetch;
  let dispatched = 0, cancelled = 0, drifted = false;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/call") dispatched++;
    const result = body.method === "initialize" ? { protocolVersion: "2025-06-18" }
      : body.method === "tools/list" ? { tools: [{ ...tool, inputSchema: drifted ? { type: "object" } : { required: ["market"], additionalProperties: false, properties: { market: { type: "string" } }, type: "object" } }] }
      : { content: [{ type: "text", text: "isolated response" }] };
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`: keepalive\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: "unrelated", result: {} })}\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`));
    }, cancel() { cancelled++; } }), { headers: { "content-type": "text/event-stream" } });
  };
  try {
    assert.equal((await listSellerSpriteRemoteTools(settings))[0].name, tool.name);
    await callSellerSpriteRemoteTool(settings, tool.name, { market: "US" }, new AbortController().signal, tool.inputSchema);
    assert.equal(dispatched, 1); assert.equal(cancelled, 5);
    await assert.rejects(callSellerSpriteRemoteTool(settings, tool.name, {}, new AbortController().signal, tool.inputSchema), error => error instanceof ToolNotDispatchedError && error.code === "INVALID_TOOL_ARGUMENTS");
    drifted = true;
    await assert.rejects(callSellerSpriteRemoteTool(settings, tool.name, {}, new AbortController().signal, tool.inputSchema), error => error instanceof ToolNotDispatchedError && error.code === "APPROVED_SCHEMA_CHANGED");
    assert.equal(dispatched, 1);
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
    const run = await engine().create({ requirement: "isolated live branch verification。付费请求必须先批准。", marketplace: "US", skills: SKILLS.map((name) => ({ name, path: "isolated", sha256: "isolated", markdown: "isolated", tools: [] })), policies: { [tool.name]: policy }, limits: { sellersprite: 1 } });
    let state = await engine().step(run.id);
    assert.equal(state.gate?.kind, "MCP_CALL"); assert.equal(dispatches, 0);
    await assert.rejects(engine().decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: state.gate!.id, callId: "wrong" }), /MISMATCH/);
    state = await engine().decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: state.gate!.id, callId: state.pendingActionId });
    state = await engine().step(run.id);
    assert.equal(dispatches, 1); assert.equal(state.gate, undefined); assert.ok(state.calls[0].rawResponse);
    assert.equal(state.calls[0].billing, "UNKNOWN"); assert.equal(state.calls[0].authorizationMode, "FIRST_APPROVAL");
    assert.equal(state.calls[0].service, "sellersprite");
    assert.equal(budgetSummary(state).sellersprite.committed, 1); // Calls are never represented as credits.
    changed = true;
    state = await engine().step(run.id);
    assert.equal(state.status, "FAILED"); assert.equal(dispatches, 1);
    assert.equal(state.failure, "PAID_TOOL_SCHEMA_CHANGED");
    state = await engine().recover(run.id);
    assert.equal(state.pendingActionApproved, undefined); assert.equal(state.pendingAction, undefined);
    assert.equal(state.paidCallAuthorization, undefined);
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
    for (const message of ["RESEARCH_AI_REQUEST_FAILED", "RESEARCH_AI_HTTP_401", "RESEARCH_AI_HTTP_401 Bearer isolated-private-secret"]) {
      const store = new LocalResearchStore(root);
      const engine = new ResearchEngine(store, { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" }, { async listTools() { return []; }, async callTool() { throw new Error("unreachable"); } }, { async next() { throw new Error(message); } }, { mode: "fixture" });
      const run = await engine.create({ requirement: "Isolated error handling verification。付费请求必须先批准。", marketplace: "US", policies: {}, limits: {}, skills: SKILLS.map(name => ({ name, path: "isolated", sha256: "isolated", markdown: "isolated", tools: [] })) });
      const failed = await engine.step(run.id);
      assert.equal(failed.status, "FAILED");
      assert.equal(failed.failure, ["RESEARCH_AI_REQUEST_FAILED", "RESEARCH_AI_HTTP_401"].includes(message) ? message : "RESEARCH_STEP_FAILED_REVIEW_CONTEXT");
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
      let run = await engine.create({ requirement: "Isolated unknown dispatch verification。付费请求必须先批准。", marketplace: "US", policies: { [tool.name]: sellerSpritePolicy(tool)! }, limits: { sellersprite: 1 }, skills: SKILLS.map(name => ({ name, path: "isolated", sha256: "isolated", markdown: "isolated", tools: [] })) });
      run = await engine.step(run.id);
      run = await engine.decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: run.gate!.id, callId: run.pendingActionId });
      run = await engine.step(run.id);
      assert.equal(run.calls[0].dispatch, "ATTEMPTED");
      assert.equal(run.calls[0].status, "FAILED");
      assert.equal(run.gate, undefined);
      assert.deepEqual(budgetSummary(run).sellersprite, { limit: 1, committed: 1, unknownCalls: 1 });
      delete run.calls[0].dispatch; // Older persisted runs do not carry the new field.
      assert.deepEqual(budgetSummary(run).sellersprite, { limit: 1, committed: 1, unknownCalls: 1 });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
