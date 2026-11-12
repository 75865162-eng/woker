import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";
import { getModuleIdForPath, roleCanPerformAction } from "@/lib/accounts/permissions";
import { listSkills, listTools, listWorkflows, findSkill, skillMarkdown } from "@/lib/lili/catalog";
import { liliNavigation, resolveLiliPage, withBasePath } from "@/lib/lili/routes";
import { runCatalogTool, validateToolInput } from "@/lib/lili/tool-execution";
import { handleLiliRequest, type LiliAuthorize } from "@/lib/lili/api";

const allow: LiliAuthorize = async () => ({ ok: true });
function request(path: string, body?: unknown, origin?: string) {
  return new Request(`http://lili.invalid/api/lili/${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
}

test("all shipped Lili definitions, translations and full skill procedures are retained", async () => {
  assert.equal(listSkills().length, 116); assert.equal(listTools().length, 107);
  assert.equal(listWorkflows().length, 12);
  for (const rows of [listSkills(), listWorkflows()]) assert.equal(new Set(rows.map((row) => row.slug)).size, rows.length);
  for (const skill of listSkills()) { assert.ok(skill.promptZh); assert.ok(skill.promptEn); assert.ok((await skillMarkdown(skill.slug))!.length > 500); }
  const recovery = await skillMarkdown("reimbursement-recovery");
  assert.ok(recovery?.includes("用 `data_query` 分别分页读取"));
  assert.ok(recovery?.includes("data_sync_status` 核对报告发布、失败及覆盖状态"));
  assert.ok(recovery?.includes("不要重复请求相同报告"));
  assert.ok(recovery?.includes("ARCHIVED_SITE_PENDING"));
  assert.ok(!recovery?.includes("用售价、采购、头程、佣金、FBA 和广告费拆每个 SKU"));
  const missing = new Set<string>();
  for (const workflow of listWorkflows()) {
    assert.ok(workflow.promptZh); assert.ok(workflow.promptEn); assert.ok(workflow.steps.length);
    for (const step of workflow.steps) if (step.skill && !findSkill(step.skill)) missing.add(step.skill);
  }
  assert.deepEqual([...missing], ["amazon-price-tracker"], "Known missing source definition must remain explicit");
});

test("native paths preserve all directory, detail and lab entries and reject extra segments", () => {
  assert.equal(resolveLiliPage([])?.kind, "start");
  for (const item of liliNavigation) assert.equal(resolveLiliPage(["v2", item.path])?.kind, item.path);
  for (const kind of ["team", "settings", "help"]) {
    assert.ok(!liliNavigation.some((item) => item.path === kind));
    assert.equal(resolveLiliPage(["v2", kind])?.kind, kind);
  }
  for (const kind of ["skills", "cases", "tools", "workflows"]) assert.equal(resolveLiliPage(["v2", kind, "slug"])?.slug, "slug");
  assert.equal(resolveLiliPage(["v2", "lab", "skills", "slug"])?.kind, "skills");
  assert.equal(resolveLiliPage(["v2", "lab", "cases", "slug"])?.kind, "cases");
  for (const parts of [["v2", "team", "extra"], ["v2", "tools", "slug", "extra"], ["bad"], ["v2", "lab", "team"]]) assert.equal(resolveLiliPage(parts), null);
  for (const parts of [["v2", "courses"], ["v2", "courses", "codex-listings"], ["v2", "courses", "setup-qa"], ["v2", "lab", "courses", "codex-listings"]]) assert.equal(resolveLiliPage(parts), null);
  assert.equal(withBasePath("/api/tools/run"), "/api/lili/tools/run");
  assert.equal(withBasePath("/v2/skills"), "/lili/v2/skills");
  assert.equal(withBasePath("/lili/v2/skills"), "/lili/v2/skills");
});

test("Lili pages reuse their actual host module permission, including settings and accounts", () => {
  assert.equal(getModuleIdForPath("/lili/v2/skills"), "agents");
  assert.equal(getModuleIdForPath("/lili/v2/tool-config"), "settings");
  assert.equal(getModuleIdForPath("/lili/v2/team"), "accounts");
  const permissions = { limited: { agents: ["view" as const] } };
  assert.equal(roleCanPerformAction("limited", getModuleIdForPath("/lili/v2/skills"), "view", permissions), true);
  assert.equal(roleCanPerformAction("limited", getModuleIdForPath("/lili/v2/team"), "view", permissions), false);
  assert.equal(roleCanPerformAction("limited", getModuleIdForPath("/lili/v2/settings"), "view", permissions), false);
});

test("private host operations reject missing sessions while forged cookies receive public definitions only", async () => {
  assert.equal((await handleLiliRequest(request("health"), ["health"])).status, 401);
  const forged = new Request("http://lili.invalid/lili/api/mcp", { headers: { cookie: "dby_session=anything; amazon_bulk_ad_session=forged.invalid" } });
  const response = await handleLiliRequest(forged, ["mcp"]);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).scope, "anonymous-definitions");
});

test("API authorization precedes catalog reads and enforces the destination module and action", async () => {
  const calls: string[] = [];
  const deny: LiliAuthorize = async (moduleId, action) => { calls.push(`${moduleId}:${action}`); return { ok: false, response: new Response(null, { status: 403 }) }; };
  assert.equal((await handleLiliRequest(request("tool-config"), ["tool-config"], deny)).status, 403);
  assert.deepEqual(calls, ["settings:view"]);
  const viewOnly: LiliAuthorize = async (moduleId, action) => { calls.push(`${moduleId}:${action}`); return action === "view" ? { ok: true } : { ok: false, response: new Response(null, { status: 403 }) }; };
  assert.equal((await handleLiliRequest(request("team", {}), ["team"], viewOnly)).status, 403);
  assert.equal(calls.at(-1), "accounts:create");
  assert.equal((await handleLiliRequest(request("codex-bundle"), ["codex-bundle"], viewOnly)).status, 403);
  assert.equal(calls.at(-1), "agents:export");
});

test("catalog tools validate input and return genuine shipped content without business data", async () => {
  assert.equal((await runCatalogTool("meta_load_skill", {})).status, 400);
  assert.equal((await runCatalogTool("meta_search_skills", { query: 42 })).status, 400);
  assert.equal((await runCatalogTool("meta_search_skills", { query: "" })).status, 400);
  assert.equal((await runCatalogTool("meta_load_skill", { skill_name: "../../.env" })).status, 404);
  const result = await runCatalogTool("meta_load_skill", { skill_name: "acos-reduction-plan" });
  assert.equal(result.status, 200); assert.ok("markdown" in result.body && result.body.markdown?.includes("ACOS"));
  const workflows = await runCatalogTool("meta_list_workflows", {});
  assert.ok("definitionOnly" in workflows.body && workflows.body.definitionOnly);
  assert.deepEqual(validateToolInput({ properties: { n: { type: "integer" } } }, { n: 1.2 }), ["n must be integer"]);
});

test("unmapped reads and all business writes refuse execution, even with a forged store scope", async () => {
  for (const [name, input] of [["meta_list_stores", {}], ["listing_get_live", { sku: "fixture-sku" }], ["ads_generate_recommendations", { store_scope: "other-workspace" }]] as const) {
    const result = await runCatalogTool(name, input);
    assert.equal(result.status, 501, name); assert.equal(result.body.ok, false);
  }
  assert.equal((await runCatalogTool("unknown", {})).status, 404);
});

test("RPC keeps business failures explicit and does not grant personal Amazon MCP access", async () => {
  const response = await handleLiliRequest(request("mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "meta_list_stores", arguments: {} } }), ["mcp"], allow);
  const body = await response.json();
  assert.equal(body.result.isError, true); assert.match(body.result.content[0].text, /RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN/);
  const listed = await (await handleLiliRequest(request("mcp", { id: 2, method: "tools/list" }), ["mcp"], allow)).json();
  assert.deepEqual(listed.result.tools.map((tool: { name: string }) => tool.name).sort(), ["meta_search_skills", "meta_load_skill", "meta_list_workflows", "lili_ping", "meta_get_skill_manifest", "meta_get_market_access", "workflow_sync_review", "workflow_sync_confirm", "research_prepare", "research_record_charge", "research_evidence", "research_list", "research_start", "research_read", "research_confirm", "research_step", "research_export", "research_pause", "research_resume", "research_recover", "research_cancel"].sort());
  assert.equal(listed.result.tools.filter((tool: { provider?: string }) => tool.provider === "skills").length, 6);
  assert.deepEqual(listed.result.tools.filter((tool: { name: string }) => tool.name.startsWith("research_")).map((tool: { name: string }) => tool.name), ["research_prepare", "research_confirm", "research_record_charge", "research_evidence", "research_list", "research_start", "research_read", "research_step", "research_export", "research_pause", "research_resume", "research_recover", "research_cancel"]);
  const discovery = await (await handleLiliRequest(request("mcp"), ["mcp"], allow)).json();
  assert.deepEqual(discovery.tools, listed.result.tools, "GET and JSON-RPC must expose the same runtime and workflow tools");
  assert.equal(discovery.scope, "authenticated-ERP-session");
  assert.equal((await handleLiliRequest(request("mcp", { method: "tools/call", params: [] }), ["mcp"], allow)).status, 400);
});

test("all legacy operational endpoints have explicit authenticated refusal or host destination", async () => {
  for (const parts of [["stores"], ["ads-profiles"], ["team"], ["credits"], ["shopify"], ["feedback"], ["session"], ["connections"], ["approvals", "legacy-id"], ["workflows", "pack"], ["workflows", "run"], ["workflows", "selection-doc"]]) {
    const response = await handleLiliRequest(request(parts.join("/"), {}), parts, allow);
    assert.equal(response.status, 501, parts.join("/"));
  }
  assert.equal((await handleLiliRequest(request("workflows/selection-html"), ["workflows", "selection-html"], allow)).status, 501);
});

test("bounded payloads, unsupported methods and foreign origins are refused without echoing secrets", async () => {
  assert.equal((await handleLiliRequest(request("tools/run", { name: "meta_search_skills", input: { query: "ads" } }, "http://attacker.invalid"), ["tools", "run"], allow)).status, 403);
  assert.equal((await handleLiliRequest(request("tools/run"), ["tools", "run"], allow)).status, 405);
  assert.equal((await handleLiliRequest(request("tools/run", { value: "x".repeat(17000) }), ["tools", "run"], allow)).status, 400);
  assert.equal((await handleLiliRequest(request("constructor"), ["constructor"], allow)).status, 404);
  const scoped: LiliAuthorize = async (_module, _action, incoming) => {
    assert.equal((await incoming.clone().json()).workspaceId, "fixture-workspace");
    return { ok: true };
  };
  assert.equal((await handleLiliRequest(request("tools/run", { name: "meta_list_workflows", input: {}, workspaceId: "fixture-workspace" }), ["tools", "run"], scoped)).status, 200);
  let oversizedAuthorized = false;
  assert.equal((await handleLiliRequest(request("tools/run", { value: "x".repeat(17000) }), ["tools", "run"], async () => { oversizedAuthorized = true; return { ok: true }; })).status, 400);
  assert.equal(oversizedAuthorized, false);
  const unavailable: LiliAuthorize = async () => { throw new Error("secret-fixture-value"); };
  const response = await handleLiliRequest(request("health"), ["health"], unavailable);
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("secret-fixture-value"));
});

test("skill bundle contains every full procedure, no credentials or invalid MCP configuration", async () => {
  const response = await handleLiliRequest(request("codex-bundle"), ["codex-bundle"], allow);
  assert.equal(response.status, 200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const files = Object.values(zip.files).filter((file) => file.name.endsWith("SKILL.md"));
  assert.equal(files.length, 116); assert.equal(zip.file("config.snippet.toml"), null);
  assert.match(await zip.file("INSTALL.md")!.async("string"), /个人凭证/);
});

test("host configuration no longer proxies Lili or bypasses host middleware", async () => {
  const config = await readFile("next.config.ts", "utf8");
  const middleware = await readFile("middleware.ts", "utf8");
  assert.ok(!config.includes("43123")); assert.ok(!middleware.includes("Lili verifies its own session"));
  assert.match(middleware, /pathname\.startsWith\("\/lili\/api\/"\)/);
});
