import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRuntimeTools } from "@/lib/lili/runtime-tools";
import { ResearchEngine, budgetSummary } from "@/lib/selection-research/engine";
import { discoverResearchTools } from "@/lib/selection-research/server";
import { loadBundledResearchSkills } from "@/lib/selection-research/skills";
import { LocalResearchStore } from "@/lib/selection-research/file-store";
import { renderResearchReport } from "@/lib/selection-research/report";
import { createLiliTransport } from "@/lib/selection-research/lili-transport";
import type { Action, Agent, ToolDefinition, Run, ObjectJson } from "@/lib/selection-research/types";

// All providers and human decisions below are isolated protocol test doubles, never a live acceptance claim.
test("ASIN workflow composes Skill, ERP and two market adapters, requires two human gates, and restores saved evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lili-asin-isolated-"));
  const asin = "B000000001";
  try {
    const dispatches: string[] = [];
    const tool = (name: string): ToolDefinition => ({ name, inputSchema: { type: "object", properties: { asin: { type: "string" } }, required: ["asin"] }, annotations: { readOnlyHint: true } });
    const runtime = createRuntimeTools((["erp", "sellersprite", "xiyou"] as const).map(id => ({ id, isReadOnly: () => true, transport: {
      async listTools() { return [tool(id === "sellersprite" ? "asin_detail" : "read_product")]; },
      async callTool(name: string) { dispatches.push(`${id}:${name}`); return { records: [], requestId: `isolated-${id}`, note: "Isolated protocol test; no market facts." }; },
    } })));
    const discovery = await discoverResearchTools(runtime.transport);
    assert.ok(discovery.registry.some(t => t.name === "meta_load_skill"));
    const calls: { tool: string; arguments: ObjectJson }[] = [
      { tool: "meta_search_skills", arguments: { query: "amazon-product-research" } },
      { tool: "meta_load_skill", arguments: { skill_name: "amazon-product-research" } },
      { tool: "erp__read_product", arguments: { asin } },
      { tool: "sellersprite__asin_detail", arguments: { asin } },
      { tool: "xiyou__read_product", arguments: { asin } },
    ];
    const agent: Agent = { async next({ run }): Promise<Action> {
      const pending = calls.find(action => !run.calls.some(call => call.tool === action.tool && call.status === "SUCCEEDED"));
      if (pending) return { type: "call", ...pending };
      const evidenceIds = run.calls.filter(call => call.provider !== "skills").map(call => call.id);
      return { type: "complete", result: {
        summary: "Isolated workflow verification; no purchasing recommendation.",
        claims: [{ text: "Protocol responses received; no market facts asserted.", kind: "observed", evidenceIds },
          ...(run.stage === 3 ? [{ text: "评论数据待验证", kind: "assumption" as const, evidenceIds: [] }] : []),
          ...(run.stage === 4 ? [{ text: "税率未核验", kind: "assumption" as const, evidenceIds: [], topic: "tariff" as const }] : [])],
        ...(run.stage === 1 ? { candidates: [{ id: asin, name: asin }] } : {}),
        ...(run.stage === 5 ? { verdict: "NEEDS_VALIDATION" as const } : {}),
      } };
    } };
    const scope = { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" };
    const engine = () => new ResearchEngine(new LocalResearchStore(root), scope, runtime.transport, agent, { mode: "live", authorizeLive: async () => true });
    let run = await engine().create({ asin, requirement: "Isolated ASIN workflow test", marketplace: "US", requiredProviders: ["erp", "sellersprite", "xiyou"], skills: await loadBundledResearchSkills(), policies: discovery.policies, limits: { sellersprite: 2, xiyou: 2 }, registry: discovery.registry });
    async function untilBusinessGate() {
      for (let i = 0; i < 30; i++) {
        run = await engine().step(run.id);
        if (run.gate?.kind === "MCP_CALL") {
          run = await engine().decide(run.id, { gateId: run.gate.id, kind: "AUTHORIZE_TOOL", callId: run.pendingActionId });
        } else if (run.gate?.kind === "BILLING") {
          const call = run.calls.at(-1)!;
          run = await engine().decide(run.id, { gateId: run.gate.id, kind: "RECONCILE", callId: call.id, units: 0, receipt: "isolated test receipt" });
        } else if (run.status === "WAITING_FOR_USER") return;
        else assert.notEqual(run.status, "FAILED", JSON.stringify(run.failure));
      }
      assert.fail("Workflow did not reach its business gate");
    }
    await untilBusinessGate();
    assert.equal(run.gate?.kind, "NICHE");
    assert.equal(dispatches.length, 3);
    await assert.rejects(engine().saveReport(run.id, async () => "forbidden"), /BOTH_HUMAN_GATES/);
    run = await engine().decide(run.id, { kind: "SELECT", gateId: run.gate!.id, candidateId: asin });
    await untilBusinessGate();
    assert.equal(run.gate?.kind, "FINAL");
    await assert.rejects(engine().saveReport(run.id, async () => "forbidden"), /BOTH_HUMAN_GATES/);
    run = await engine().decide(run.id, { kind: "CONFIRM", gateId: run.gate!.id });
    const saved = await engine().saveReport(run.id, async current => { const html = renderResearchReport(current); assert.match(html, /xiyou__read_product/); assert.match(html, /isolated-erp/); return "isolated-file"; });
    const restored: Run = await engine().inspect(run.id);
    assert.equal(restored.report?.fileId, saved.fileId);
    assert.equal(restored.asin, asin);
    assert.equal(restored.calls.filter(call => call.provider !== "skills").length, 3);
    assert.ok(restored.calls.filter(call => call.tool === "meta_load_skill").length >= 5);
    assert.equal(restored.calls.filter(c => c.service === "erp").length, 1);
    assert.equal(restored.calls.filter(c => c.service === "xiyou").length, 1);
    assert.ok(restored.calls.every(call => call.rawResponse));
    assert.equal(restored.decisions.filter(d => ["SELECT", "CONFIRM"].includes(d.decision.kind)).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Xiyou-compatible transport consumes a matching SSE response without waiting for stream closure", async () => {
  let cancelled = 0;
  const transport = createLiliTransport({ endpoint: "https://isolated.invalid/mcp", fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = body.method === "initialize" ? { protocolVersion: "2025-06-18" } : { tools: [{ name: "read_product", inputSchema: { type: "object", properties: {} } }] };
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`)); }, cancel() { cancelled++; } });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  } });
  assert.equal((await transport.listTools())[0].name, "read_product");
  assert.equal(cancelled, 2);
});

test("the first research gate requires cited successful evidence from every required source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lili-source-citations-"));
  try {
    const tool: ToolDefinition = { name: "erp__read_product", inputSchema: { type: "object" } };
    const other: ToolDefinition = { name: "xiyou__read_product", inputSchema: { type: "object" } };
    const engine = new ResearchEngine(new LocalResearchStore(root), { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" }, {
      async listTools() { return [tool, other]; }, async callTool() { return { records: [], requestId: "isolated-response" }; },
    }, { async next({ run }) {
      if (run.calls.length < 2) return { type: "call", tool: run.calls.length ? other.name : tool.name, arguments: {} };
      return { type: "complete", result: { summary: "Isolated source citation verification", claims: [{ text: "No business facts asserted", kind: "observed", evidenceIds: [run.calls[1].id] }], candidates: [{ id: "B000000001", name: "Isolated" }] } };
    } }, { mode: "live", authorizeLive: async () => true });
    let run = await engine.create({ asin: "B000000001", requirement: "Isolated evidence citation verification", marketplace: "US", skills: await loadBundledResearchSkills(), requiredProviders: ["erp"], limits: {}, policies: Object.fromEntries([tool, other].map(entry => [entry.name, { provider: entry.name === tool.name ? "erp" : "xiyou", paid: false, units: 0, unit: "calls", pricingSource: "isolated", maxCalls: 1, stages: [1] }])) });
    run = await engine.step(run.id);
    assert.equal(run.calls[0].status, "SUCCEEDED");
    run = await engine.step(run.id);
    assert.equal(run.calls[1].status, "SUCCEEDED");
    run = await engine.step(run.id);
    assert.equal(run.status, "FAILED"); assert.equal(run.failure, "REQUIRED_PROVIDER_EVIDENCE_MISSING");
    assert.equal(run.gate, undefined); assert.equal(run.results.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("gateway attests pre-dispatch revocation or schema drift, releases budget and requires fresh approval on recovery", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lili-not-sent-isolated-"));
  try {
    for (const reason of ["revoked", "schema"] as const) {
      let dispatches = 0;
      let changeAtDispatch = false;
      const definition: ToolDefinition = { name: "asin_detail", inputSchema: { type: "object", properties: { asin: { type: "string" } }, required: ["asin"] } };
      const runtime = createRuntimeTools([{ id: "sellersprite", isReadOnly: () => true, transport: {
        async listTools() {
          if (!changeAtDispatch) return [definition];
          return reason === "revoked" ? [] : [{ ...definition, inputSchema: { ...definition.inputSchema, additionalProperties: false } }];
        },
        async callTool() { dispatches++; return { requestId: "isolated-dispatch" }; },
      } }]);
      const discovery = await discoverResearchTools(runtime.transport);
      // Make the provider change after the engine's refresh but before the gateway's final check.
      const transport = { listTools: runtime.transport.listTools, async callTool(...args: Parameters<typeof runtime.transport.callTool>) {
        if (args[0] === "sellersprite__asin_detail") changeAtDispatch = true;
        return runtime.transport.callTool(...args);
      } };
      const scope = { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" };
      const agent: Agent = { async next() { return { type: "call", tool: "sellersprite__asin_detail", arguments: { asin: "B000000001" } }; } };
      const engine = new ResearchEngine(new LocalResearchStore(root), scope, transport, agent, { mode: "live", authorizeLive: async () => true });
      let run = await engine.create({ requirement: "Isolated dispatch boundary test", marketplace: "US", skills: await loadBundledResearchSkills(), policies: discovery.policies, limits: { sellersprite: 1 }, registry: discovery.registry });
      for (let i = 0; i < 3; i++) run = await engine.step(run.id);
      assert.equal(run.gate?.kind, "MCP_CALL");
      run = await engine.decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: run.gate!.id, callId: run.pendingActionId });
      run = await engine.step(run.id);
      assert.equal(dispatches, 0);
      assert.equal(run.status, "FAILED");
      assert.equal(run.gate, undefined);
      assert.equal(run.failure, reason === "revoked" ? "RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN" : "APPROVED_SCHEMA_CHANGED");
      assert.equal(run.calls.at(-1)?.dispatch, "NOT_SENT");
      assert.equal(run.calls.at(-1)?.knownUnits, 0);
      assert.equal(budgetSummary(run).sellersprite.committed, 0);
      assert.equal(budgetSummary(run).sellersprite.unknownCalls, 0);
      assert.equal((await engine.inspect(run.id)).calls.at(-1)?.dispatch, "NOT_SENT");
      changeAtDispatch = false;
      transport.callTool = runtime.transport.callTool;
      run = await engine.recover(run.id);
      run = await engine.step(run.id);
      assert.equal(run.gate?.kind, "MCP_CALL");
      assert.equal(dispatches, 0);
      run = await engine.decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: run.gate!.id, callId: run.pendingActionId });
      run = await engine.step(run.id);
      assert.equal(dispatches, 1);
      assert.equal(run.calls.at(-1)?.dispatch, "ATTEMPTED");
      assert.equal(run.gate, undefined);
      assert.equal(run.calls.at(-1)?.authorizationMode, "FIRST_APPROVAL");
      assert.ok(run.paidCallAuthorization);
      assert.equal(budgetSummary(run).sellersprite.committed, 1);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
