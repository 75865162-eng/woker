import test from "node:test";
import assert from "node:assert/strict";
import { callResearchMcpTool, researchMcpTools } from "@/lib/lili/research-tools";
import { normalizeResearchAction } from "@/lib/selection-research/action-input";

test("MCP research bridge preserves workspace/session, uses existing routes, and limits approval to explicit chat confirmation", async () => {
  const original = new Request("http://localhost/api/lili/mcp", { method: "POST", headers: { cookie: "isolated-session", "content-type": "application/json" }, body: "{}" });
  let dispatches = 0;
  const result = await callResearchMcpTool(original, "research_start", { requirement: "Research any product", marketplace: "US", workspaceId: "isolated", maxMarketCalls: 3 }, async request => {
    dispatches++;
    assert.equal(request.headers.get("cookie"), "isolated-session");
    const body = await request.json();
    assert.equal(body.budgetMode, "reviewed"); assert.equal(body.mode, "live"); assert.equal(body.executionMode, "codex");
    assert.equal(body.workspaceId, "isolated");
    assert.equal(new URL(request.url).pathname, "/api/selection-research");
    return Response.json({ run: { id: "isolated-run", status: "CREATED", budgetMode: "reviewed", skills: [], policies: {}, registry: [], limits: {}, calls: [], results: [] } }, { status: 201 });
  });
  assert.equal(result.ok, true); assert.match(result.reviewUrl!, /runId=isolated-run/);
  assert.equal(result.nextAction?.kind, "CONTINUE"); assert.equal(result.budget?.simulated, false);
  assert.ok(researchMcpTools.some(tool => tool.name === "research_confirm"));
  assert.ok(researchMcpTools.every(tool => !/decide|approve/.test(tool.name)));
  await assert.rejects(callResearchMcpTool(original, "research_step", { runId: "../other", workspaceId: "isolated", maxMarketCalls: 3 }), /SCHEMA_PATTERN/);
  await assert.rejects(callResearchMcpTool(original, "research_start", { requirement: "test", marketplace: "US", workspaceId: "isolated", maxMarketCalls: 3, approved: true }), /SCHEMA_UNKNOWN/);
  assert.equal(dispatches, 1);
});

test("MCP bridge preserves forbidden response and routes owned reads/exports without network", async () => {
  const original = new Request("http://localhost/api/lili/mcp");
  for (const [name, method, operation] of [["research_read", "GET", undefined], ["research_step", "POST", "step"], ["research_export", "POST", "export"]] as const) {
    const result = await callResearchMcpTool(original, name, { runId: "owned-run", workspaceId: "isolated" }, async (request, id) => {
      assert.equal(id, "owned-run"); assert.equal(request.method, method);
      if (operation) assert.equal((await request.json()).operation, operation);
      return Response.json({ error: "Forbidden workspace." }, { status: 403 });
    });
    assert.equal(result.ok, false); assert.equal(result.status, 403);
  }
});

test("lifecycle tools map to existing scoped commands without approval or external execution", async () => {
 const request = new Request("http://localhost/api/lili/mcp");
 for (const operation of ["pause", "resume", "recover", "cancel"]) {
  let calls = 0;
  const response = await callResearchMcpTool(request, "research_" + operation, { runId: "owned-run", workspaceId: "owned-workspace" }, async child => {
   calls++;
   assert.equal(child.method, "POST");
   assert.deepEqual(await child.json(), { workspaceId: "owned-workspace", operation });
   return Response.json({ run: { id: "owned-run", status: "RESUMABLE", pausedAt: operation === "pause" ? new Date().toISOString() : undefined, results: [], skills: [], registry: [], policies: {}, limits: {}, calls: [] } });
  });
  assert.equal(calls, 1); assert.equal(response.ok, true);
  if (operation === "pause") assert.equal(response.nextAction?.kind, "PAUSED");
 }
});

test("history tool sends scoped GET with bounded pagination and rejects identity parameters", async () => {
 const request = new Request("http://localhost/api/lili/mcp");
 const result = await callResearchMcpTool(request, "research_list", { workspaceId: "own", page: 2, pageSize: 5 }, async child => {
  assert.equal(child.method, "GET"); assert.equal(child.body, null);
  const url = new URL(child.url);
  assert.equal(url.pathname, "/api/selection-research");
  assert.equal(url.searchParams.get("workspaceId"), "own");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("pageSize"), "5");
  return Response.json({ runs: [], page: 2, pageSize: 5, hasNext: false, persisted: true });
 });
 assert.equal(result.ok, true);
 for (const extra of [{ pageSize: 51 }, { page: 0 }, { userId: "other" }, { erpCredentialId: "other" }] as Record<string, string | number>[]) await assert.rejects(callResearchMcpTool(request, "research_list", { workspaceId: "own", ...extra }));
});

test("evidence tool requests a bounded saved response without dispatching research", async () => {
 const result = await callResearchMcpTool(new Request("http://localhost/api/lili/mcp"), "research_evidence", { runId: "owned", workspaceId: "own", callId: "call-1", offset: 0, length: 100 }, async child => {
  assert.equal(child.method, "GET");
  const url = new URL(child.url); assert.equal(url.searchParams.get("view"), "evidence");
  assert.equal(url.searchParams.get("callId"), "call-1"); assert.equal(url.searchParams.get("length"), "100");
  return Response.json({ runId: "owned", callId: "call-1", chunk: "{}", nextOffset: null, persisted: true });
 });
 assert.equal(result.ok, true);
});

test("Codex action bridge forwards exact action and revision without creating approval authority", async () => {
 const action = { type: "call", tool: "sellersprite__asin.list", arguments: { marketplace: "US", keyword: "organizer" } };
 const result = await callResearchMcpTool(new Request("http://localhost/api/lili/mcp"), "research_step", { runId: "owned", workspaceId: "own", expectedRevision: 12, action }, async request => {
  assert.deepEqual(await request.json(), { workspaceId: "own", operation: "step", action, expectedRevision: 12 });
  return Response.json({ run: { id: "owned", requirement: "付费请求必须先批准。", status: "WAITING_FOR_USER", gate: { kind: "MCP_CALL" }, results: [], skills: [], policies: {}, limits: {}, registry: [], calls: [] } });
 });
 assert.equal(result.nextAction?.kind, "HUMAN_REVIEW");
});

test("native MCP JSON-string payloads are decoded once without changing their meaning", async () => {
 const payload = { marketplace: "US", keyword: "saxophone strap", page: { size: 100, cursor: 0 }, desc: true };
 const action = { type: "call", tool: "sellersprite__asin.list", arguments: JSON.stringify(payload) };
 const original = structuredClone(action);
 await callResearchMcpTool(new Request("http://localhost/api/lili/mcp"), "research_step", { runId: "owned", workspaceId: "own", expectedRevision: 9, action }, async request => {
  const body = await request.json();
  assert.deepEqual(body.action, { ...action, arguments: payload });
  assert.equal(body.expectedRevision, 9);
  assert.equal(body.operation, "step");
  return Response.json({ run: { id: "owned", status: "RESUMABLE", results: [], skills: [], policies: {}, limits: {}, registry: [], calls: [] } });
 });
 assert.deepEqual(action, original);
 const result = { summary: "isolated", claims: [], candidates: [] };
 assert.deepEqual(normalizeResearchAction({ type: "complete", result: JSON.stringify(result) }), { type: "complete", result });
});

test("invalid native payloads and encoded credentials never reach the research route", async () => {
 let dispatched = 0;
 const request = new Request("http://localhost/api/lili/mcp");
 for (const [payload, error] of [
  ["{broken", "RESEARCH_ACTION_JSON_INVALID"],
  ["[]", "RESEARCH_ACTION_OBJECT_REQUIRED"],
  ["null", "RESEARCH_ACTION_OBJECT_REQUIRED"],
  ["123", "RESEARCH_ACTION_OBJECT_REQUIRED"],
  [JSON.stringify("{}"), "RESEARCH_ACTION_OBJECT_REQUIRED"],
  [null, "RESEARCH_ACTION_OBJECT_REQUIRED"],
  [" ".repeat(64001), "RESEARCH_ACTION_JSON_TOO_LARGE"],
  ['{"apiKey":"isolated-secret"}', "CREDENTIAL_FIELD_REJECTED"],
 ] as const) {
  await assert.rejects(callResearchMcpTool(request, "research_step", { runId: "owned", workspaceId: "own", expectedRevision: 1,
   action: { type: "call", tool: "sellersprite__asin.list", arguments: payload } }, async () => { dispatched++; return Response.json({}); }), new RegExp(error));
 }
 assert.equal(dispatched, 0);
 assert.throws(() => normalizeResearchAction({ type: "call", tool: "x", arguments: {}, approved: true }), /INVALID_EXTERNAL/);
 assert.throws(() => normalizeResearchAction({ type: "complete", result: {}, arguments: {} }), /INVALID_EXTERNAL/);
});

test("legacy billing gates always return continuation even when Skill requires fee confirmation", async () => {
  const result = await callResearchMcpTool(new Request("http://localhost/api/lili/mcp"), "research_read", { runId: "owned", workspaceId: "isolated" }, async () => Response.json({ run: {
    id: "owned", status: "WAITING_FOR_USER", stage: 1, requirement: "Research", gate: { id: "old", kind: "BILLING", reason: "unknown fee" },
    budgetMode: "uncapped", skills: [{ name: "research", sha256: "fixture", markdown: "费用核对必须先确认。" }], policies: {}, registry: [], limits: {}, calls: [], results: [],
  } }));
  assert.equal(result.feeApprovalRequired, true, "pre-call policy is independent from billing recovery");
  assert.equal(result.nextAction?.kind, "CONTINUE");
  assert.match(result.nextAction!.message!, /research_resume/);
});
