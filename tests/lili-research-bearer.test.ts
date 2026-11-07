import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { middleware } from "../middleware";
import { handleResearchBearerMcp, type ResearchBearerDependencies, type ResearchMcpIdentity } from "@/lib/lili/research-bearer-mcp";
import { researchRequestAuthorization, withResearchRequestAuthorization } from "@/lib/selection-research/request-authorization";

const identity: ResearchMcpIdentity = { id: "fixture-credential", userId: "fixture-user", organizationId: "fixture-org", workspaceId: "fixture-workspace", revision: 1, tools: ["research_start", "research_read", "research_step", "research_export"] };
const user = { id: identity.userId, organizationId: identity.organizationId, organizationName: "Fixture", role: "owner", email: "fixture@example.test", name: "Fixture" };
function fixture(overrides: Partial<ResearchBearerDependencies> = {}) {
  const audits: Parameters<ResearchBearerDependencies["audit"]>[1][] = [];
  const checks: string[] = [];
  const deps: ResearchBearerDependencies = {
    authenticate: async () => structuredClone(identity),
    permission: async (_identity, moduleId, action) => { checks.push(`${moduleId}:${action}`); return { ok: true, user }; },
    audit: async (_identity, event) => { audits.push(event); },
    dispatch: async request => {
      const bound = researchRequestAuthorization(request);
      assert.equal(bound?.credentialId, identity.id);
      assert.equal((await bound!.authorize("agents", "approve", request)).ok, false);
      return Response.json({ error: "fixture dispatch" }, { status: 409 });
    }, ...overrides,
  };
  return { deps, audits, checks };
}
async function rpc(deps: ResearchBearerDependencies, method: string, params?: unknown, options: { origin?: string; url?: string; httpMethod?: string } = {}) {
  const body = { jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) };
  const request = new Request(options.url ?? "http://fixture.invalid/api/lili/mcp", { method: options.httpMethod ?? "POST", headers: { authorization: "Bearer fixture-token", ...(options.origin ? { origin: options.origin } : {}) } });
  return handleResearchBearerMcp(request, body, deps);
}

test("bearer discovery exposes only explicit research grants and local Skills; ERP grants gain only their existing authorized registry", async () => {
  const f = fixture({ authenticate: async () => ({ ...identity, tools: ["data_query"] }) });
  assert.equal((await rpc(f.deps, "tools/list")).status, 200);
  assert.equal(f.audits.at(-1)?.status, "SUCCEEDED");
  const restricted = fixture({ authenticate: async () => ({ ...identity, tools: ["research_read"] }) });
  const result = await (await rpc(restricted.deps, "tools/list")).json();
  assert.deepEqual(result.result.tools.filter((t: { name: string }) => t.name.startsWith("research_")).map((t: { name: string }) => t.name), ["research_prepare", "research_read"]);
  assert.deepEqual(result.result.tools.map((tool: { name: string }) => tool.name).sort(), ["research_prepare", "research_read", "meta_search_skills", "meta_load_skill", "meta_list_workflows", "lili_ping", "meta_get_skill_manifest", "meta_get_market_access"].sort());
  assert.equal(result.result.tools.find((t: { name: string }) => t.name === "research_read").inputSchema.properties.workspaceId.const, identity.workspaceId);
  assert.ok(result.result.tools.every((t: { name: string }) => !t.name.startsWith("erp__") && !t.name.startsWith("xiyou__") && !t.name.startsWith("sellersprite__")));
});

test("live role permissions filter discovery and deny commands even when credential grants them", async () => {
  const f = fixture({ permission: async (_identity, _module, action) => action === "view" ? { ok: true, user } : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } });
  const result = await (await rpc(f.deps, "tools/list")).json();
  assert.deepEqual(result.result.tools.filter((t: { name: string }) => t.name.startsWith("research_")).map((t: { name: string }) => t.name), ["research_prepare", "research_read"]);
  assert.equal((await rpc(f.deps, "tools/call", { name: "research_step", arguments: { workspaceId: identity.workspaceId, runId: "fixture-run" } })).status, 403);
});

test("invalid, expired and revoked credentials fail closed without leaking provider errors", async () => {
  for (const status of [401, 403]) {
    const f = fixture({ authenticate: async () => { throw Object.assign(new Error("fixture-secret-never-output"), { status }); } });
    const response = await rpc(f.deps, "tools/list");
    assert.equal(response.status, status); assert.ok(!(await response.text()).includes("fixture-secret"));
  }
  let calls = 0;
  const f = fixture({ authenticate: async () => ({ ...identity, revision: ++calls === 1 ? 1 : 2 }) });
  assert.equal((await rpc(f.deps, "tools/list")).status, 403);
});

test("research calls pin scope and ERP credential, cannot approve or directly dispatch market tools", async () => {
  let dispatched = 0;
  let savedRequest: Request | undefined;
  const f = fixture({ dispatch: async request => {
    dispatched++; savedRequest = request;
    const command = await request.clone().json();
    assert.equal(command.erpCredentialId, identity.id);
    assert.equal(command.mode, "live"); assert.equal(command.budgetMode, "reviewed");
    const bound = researchRequestAuthorization(request)!;
    assert.equal((await bound.authorize("agents", "approve", request)).ok, false);
    return Response.json({ error: "fixture human review required" }, { status: 409 });
  } });
  const command = { requirement: "fixture product", marketplace: "US", workspaceId: identity.workspaceId, maxMarketCalls: 3 };
  for (const args of [{ ...command, workspaceId: "other" }, { ...command, erpCredentialId: "other" }]) {
    assert.equal((await rpc(f.deps, "tools/call", { name: "research_start", arguments: args })).status, 403);
  }
  for (const name of ["research_approve", "research_decide", "sellersprite__product_search", "erp__data_query"]) {
    assert.equal((await rpc(f.deps, "tools/call", { name, arguments: {} })).status, 403);
  }
  const response = await rpc(f.deps, "tools/call", { name: "research_start", arguments: command });
  assert.equal((await response.json()).result.isError, true);
  assert.equal(dispatched, 1);
  assert.equal(researchRequestAuthorization(savedRequest!), undefined, "authority must disappear after dispatch");
  assert.ok(f.checks.includes("agents:create"));
});

test("schema validation prevents smuggling approval or fixture execution into a research command", async () => {
  const f = fixture({ dispatch: async () => { assert.fail("must not dispatch"); } });
  for (const extra of [{ approved: true }, { operation: "decide" }, { mode: "fixture" }]) {
    const response = await rpc(f.deps, "tools/call", { name: "research_start", arguments: { requirement: "fixture", marketplace: "US", workspaceId: identity.workspaceId, ...extra } });
    assert.equal(response.status, 400);
  }
});

test("authenticated clients can prepare a brief without dispatching a stored research command", async () => {
  const f = fixture({ dispatch: async () => { assert.fail("preparation cannot dispatch a persisted task"); } });
  const response = await rpc(f.deps, "tools/call", { name: "research_prepare", arguments: { requirement: "研究 any product", marketplace: "US" } });
  const result = JSON.parse((await response.json()).result.content[0].text);
  assert.equal(result.stage, 0); assert.equal(result.persisted, false); assert.equal(result.marketDataCollected, false);
});

test("external clients receive navigable human-review and phase-report links", async () => {
  const f = fixture({ dispatch: async () => Response.json({ run: { id: "fixture-run", status: "WAITING_FOR_USER", gate: { kind: "NICHE" }, budgetMode: "reviewed", skills: [], registry: [], policies: {}, limits: {}, calls: [], results: [{ summary: "fixture phase" }] } }) });
  const response = await rpc(f.deps, "tools/call", { name: "research_read", arguments: { runId: "fixture-run", workspaceId: identity.workspaceId } });
  const result = JSON.parse((await response.json()).result.content[0].text);
  assert.match(result.reviewUrl, /^http:\/\/fixture\.invalid\/agents\/selection-research\?/);
  assert.match(result.stageReports[0].url, /^http:\/\/fixture\.invalid\/api\/selection-research\/fixture-run\/report\?/);
  assert.equal(result.nextAction.kind, "HUMAN_REVIEW");
});

test("a permission resolver cannot substitute another owner or organization", async () => {
  for (const changed of [{ id: "other" }, { organizationId: "other" }]) {
    const f = fixture({ permission: async () => ({ ok: true, user: { ...user, ...changed } }) });
    assert.equal((await rpc(f.deps, "tools/list")).status, 403);
  }
});

test("protocol rejects foreign origins, malformed params and GET; no request body or token is audited", async () => {
  const f = fixture();
  assert.equal((await rpc(f.deps, "tools/list", {}, { origin: "http://other.invalid" })).status, 403);
  assert.equal((await rpc(f.deps, "tools/list", [], {})).status, 400);
  assert.equal((await rpc(f.deps, "tools/list", undefined, { httpMethod: "GET" })).status, 405);
  const init = await (await rpc(f.deps, "initialize", { protocolVersion: "2025-06-18" })).json();
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal((await rpc(f.deps, "initialize", { protocolVersion: "unknown" })).status, 400);
  const text = JSON.stringify(f.audits);
  assert.ok(!text.includes("fixture-token")); assert.ok(!text.includes("arguments"));
});

test("trusted dispatch authorization is request-local, rejects unrelated routes and is cleared on failure", async () => {
  const request = new Request("http://fixture.invalid/api/selection-research/fixture-run");
  const authorization = { credentialId: identity.id, authorize: fixture().deps.permission.bind(null, identity) };
  await assert.rejects(withResearchRequestAuthorization(request, authorization, async () => {
    assert.ok(researchRequestAuthorization(request));
    assert.equal(researchRequestAuthorization(request.clone()), undefined);
    throw new Error("fixture failure");
  }), /fixture failure/);
  assert.equal(researchRequestAuthorization(request), undefined);
  await assert.rejects(withResearchRequestAuthorization(new Request("http://fixture.invalid/api/ai-settings"), authorization, async () => {}), /RESEARCH_SCOPE_DENIED/);
});

test("middleware admits only exact bearer MCP endpoints; approvals and configuration remain session-protected", async () => {
  for (const path of ["/api/lili/mcp", "/lili/api/mcp"]) {
    assert.equal((await middleware(new NextRequest(`http://fixture.invalid${path}`, { headers: { authorization: "Bearer fixture-token" } }))).headers.get("x-middleware-next"), "1");
    assert.equal((await middleware(new NextRequest(`http://fixture.invalid${path}`))).headers.get("x-middleware-next"), "1");
  }
  for (const path of ["/api/lili/tool-config", "/api/lili/mcp/extra", "/api/selection-research/fixture-run", "/lili/api/approvals/fixture"]) {
    assert.equal((await middleware(new NextRequest(`http://fixture.invalid${path}`, { headers: { authorization: "Bearer fixture-token" } }))).status, 401);
  }
});

test("unified bearer tools use the exact authorized ERP registry and never advertise market or writes", async () => {
 let calls = 0;
 const definition = { name: "data_query", description: "real adapter definition", inputSchema: { type: "object", properties: { table: { type: "string" } }, required: ["table"], additionalProperties: false } };
 const f = fixture({ authenticate: async () => ({...identity,tools:["data_query"]}), erp: async () => ({ listTools:async()=>[definition],callTool:async(name,args)=>{calls++;return {name,args};} }) });
 const list = await (await rpc(f.deps,"tools/list")).json();
 assert.deepEqual(list.result.tools.find((t:{name:string})=>t.name==="data_query"),definition);
 assert.equal(list.result.tools.some((t:{name:string})=>t.name==="research_start"),false);
 assert.equal((await rpc(f.deps,"tools/call",{name:"data_query",arguments:{table:"inventory"}})).status,200);assert.equal(calls,1);
 for(const name of ["data_sync_start","sellersprite__product_search"])assert.equal((await rpc(f.deps,"tools/call",{name,arguments:{}})).status,403);
 const market = JSON.parse((await (await rpc(f.deps,"tools/call",{name:"meta_get_market_access",arguments:{}})).json()).result.content[0].text);
 assert.equal(market.direct_market_access,false);assert.equal(market.estimated_cost,null);
});

test("market-access metadata uses server identity and never probes a paid provider", async () => {
 let checks = 0;
 const f = fixture({ marketAccess: async current => { checks++; assert.equal(current.userId, identity.userId); return { authenticated: true, research_access: false, direct_market_access: false, estimated_cost: null }; }, erp: async () => { assert.fail("metadata cannot probe ERP or market registry"); } });
 const response = await rpc(f.deps, "tools/call", { name: "meta_get_market_access", arguments: {} });
 assert.equal(response.status, 200);
 assert.equal(JSON.parse((await response.json()).result.content[0].text).research_access, false);
 assert.equal(checks, 1);
 assert.equal((await rpc(f.deps, "tools/call", { name: "meta_get_market_access", arguments: { userId: "other" } })).status, 400);
 assert.equal(checks, 1);
});

test("lifecycle commands require explicit per-tool grants and cannot impersonate another workspace", async () => {
 let dispatched = 0;
 const f = fixture({ authenticate: async () => ({ ...identity, tools: ["research_pause"] }), dispatch: async request => { dispatched++; assert.equal((await request.json()).operation, "pause"); return Response.json({ run: { id: "owned", status: "RESUMABLE", pausedAt: new Date().toISOString(), results: [], skills: [], registry: [], policies: {}, limits: {}, calls: [] } }); } });
 const catalog = await (await rpc(f.deps, "tools/list")).json();
 assert.ok(catalog.result.tools.some((t: { name: string }) => t.name === "research_pause"));
 assert.ok(!catalog.result.tools.some((t: { name: string }) => t.name === "research_resume"));
 assert.equal((await rpc(f.deps, "tools/call", { name: "research_resume", arguments: { runId: "owned" } })).status, 403);
 assert.equal((await rpc(f.deps, "tools/call", { name: "research_pause", arguments: { runId: "owned", workspaceId: "other" } })).status, 403);
 assert.equal((await rpc(f.deps, "tools/call", { name: "research_pause", arguments: { runId: "owned" } })).status, 200);
 assert.equal(dispatched, 1);
});

test("history requires its own grant, pins workspace and binds GET to verified request identity", async () => {
 let dispatched = 0;
 const f = fixture({ authenticate: async () => ({ ...identity, tools: ["research_list"] }), dispatch: async request => {
  dispatched++; assert.equal(request.method, "GET");
  assert.equal(new URL(request.url).searchParams.get("workspaceId"), identity.workspaceId);
  assert.equal(researchRequestAuthorization(request)?.credentialId, identity.id);
  return Response.json({ runs: [], page: 1, pageSize: 20, hasNext: false, persisted: true });
 } });
 const response = await rpc(f.deps, "tools/call", { name: "research_list", arguments: {} });
 assert.equal(response.status, 200);
 assert.equal(JSON.parse((await response.json()).result.content[0].text).persisted, true);
 assert.equal(dispatched, 1);
 assert.equal((await rpc(f.deps, "tools/call", { name: "research_list", arguments: { workspaceId: "other" } })).status, 403);
 const denied = fixture({ authenticate: async () => ({ ...identity, tools: ["research_read"] }), dispatch: async () => { assert.fail("ungranted history cannot dispatch"); } });
 assert.equal((await rpc(denied.deps, "tools/call", { name: "research_list", arguments: {} })).status, 403);
});

test("evidence reads require explicit grants and pin owner scope before saved-data dispatch", async () => {
 let dispatched = 0;
 const f = fixture({ authenticate: async () => ({ ...identity, tools: ["research_evidence"] }), dispatch: async request => {
  dispatched++; assert.equal(request.method, "GET");
  assert.equal(new URL(request.url).searchParams.get("view"), "evidence");
  assert.equal(researchRequestAuthorization(request)?.credentialId, identity.id);
  return Response.json({ runId: "owned", calls: [], persisted: true });
 } });
 assert.equal((await rpc(f.deps, "tools/call", { name: "research_evidence", arguments: { runId: "owned" } })).status, 200);
 assert.equal((await rpc(f.deps, "tools/call", { name: "research_evidence", arguments: { runId: "owned", workspaceId: "other" } })).status, 403);
 assert.equal(dispatched, 1);
 const ungranted = fixture();
 assert.equal((await rpc(ungranted.deps, "tools/call", { name: "research_evidence", arguments: { runId: "owned" } })).status, 403);
});
