import test from "node:test";
import assert from "node:assert/strict";
import { handleLiliRequest, type LiliAuthorize } from "@/lib/lili/api";
import { createRuntimeTools } from "@/lib/lili/runtime-tools";
import { createHash } from "node:crypto";
import { skillMarkdown } from "@/lib/lili/catalog";
import { callPublicResearchTool } from "@/lib/lili/public-research-tools";
import type { ObjectJson } from "@/lib/selection-research/types";

function request(method: string, params?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://fixture.invalid/api/lili/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }) });
}
const denied: LiliAuthorize = async () => ({ ok: false, response: Response.json({ error: "Unauthorized." }, { status: 401 }) });

test("anonymous clients initialize, discover, search and load original Skills without a session or providers", async () => {
  let providerReads = 0;
  const providers = createRuntimeTools([{ id: "erp", isReadOnly: () => true, transport: { listTools: async () => { providerReads++; throw new Error("must not discover user providers"); }, callTool: async () => { providerReads++; throw new Error("must not query data"); } } }]);
  const init = await handleLiliRequest(request("initialize", { protocolVersion: "2025-06-18" }), ["mcp"], denied, undefined, providers);
  assert.equal(init.status, 200); assert.equal((await init.json()).result.serverInfo.name, "lili-mcp");
  const listed = await (await handleLiliRequest(request("tools/list"), ["mcp"], denied, undefined, providers)).json();
  assert.equal(listed.result.scope, "anonymous-definitions");
  assert.deepEqual(listed.result.providers, []);
  assert.deepEqual(listed.result.tools.map((tool: { name: string }) => tool.name).sort(), ["meta_search_skills", "meta_load_skill", "meta_list_workflows", "lili_ping", "meta_get_skill_manifest", "meta_get_market_access", "research_prepare", "research_evidence", "research_list", "research_start", "research_read", "research_step", "research_export", "research_pause", "research_resume", "research_recover", "research_cancel"].sort());
  assert.ok(listed.result.tools.every((tool: { name: string }) => !tool.name.startsWith("erp__")));
  assert.ok(listed.result.tools.find((tool: { name: string }) => tool.name === "research_start").description.includes("require authenticated"));
  for (const [name, args, field] of [["meta_search_skills", { query: "niche" }, "skills"], ["meta_load_skill", { skill_name: "amazon-niche-finder" }, "markdown"], ["meta_list_workflows", {}, "templates"]] as const) {
    const response = await handleLiliRequest(request("tools/call", { name, arguments: args }), ["mcp"], denied, undefined, providers);
    const result = (await response.json()).result;
    assert.equal(result.isError, false); assert.ok(JSON.parse(result.content[0].text)[field]);
  }
  const discovery = await (await handleLiliRequest(new Request("http://fixture.invalid/lili/api/mcp"), ["mcp"], denied)).json();
  assert.equal(discovery.scope, "anonymous-definitions");
  assert.equal(providerReads, 0);
  const actualAnonymous = await handleLiliRequest(request("tools/list"), ["mcp"]);
  assert.equal(actualAnonymous.status, 200);
  assert.equal((await actualAnonymous.json()).result.scope, "anonymous-definitions");
});

test("anonymous business requests cannot select a default organization or access configurations and saved research", async () => {
  for (const name of ["research_list", "research_start", "research_read", "research_step", "research_export", "research_pause", "research_resume", "research_recover", "research_cancel", "erp__data_query", "sellersprite__product_search"]) {
    const response = await handleLiliRequest(request("tools/call", { name, arguments: { workspaceId: "default", runId: "other-user" } }, { "x-workspace-id": "default", "x-user-id": "forged" }), ["mcp"], denied);
    assert.equal(response.status, 401, name);
    assert.equal((await response.json()).error.data.businessCode, "AUTHENTICATED_DATA_SCOPE_REQUIRED");
  }
  for (const parts of [["tool-config"], ["stores"], ["connections"], ["approvals", "other-user"]]) {
    assert.equal((await handleLiliRequest(new Request(`http://fixture.invalid/api/lili/${parts.join("/")}`), parts, denied)).status, 401);
  }
});

test("public Skill operations remain usable when the session store is unavailable and never echo errors", async () => {
  const unavailable: LiliAuthorize = async () => { throw new Error("private-session-store-error"); };
  for (const method of ["initialize", "ping", "tools/list"]) {
    const response = await handleLiliRequest(request(method, { protocolVersion: "2025-06-18" }), ["mcp"], unavailable);
    assert.equal(response.status, 200); assert.ok(!(await response.text()).includes("private-session-store-error"));
  }
  const response = await handleLiliRequest(request("tools/call", { name: "research_read", arguments: {} }), ["mcp"], unavailable);
  assert.equal(response.status, 503);
});

test("anonymous request validation rejects foreign origins and unsafe Skill arguments", async () => {
  assert.equal((await handleLiliRequest(request("tools/list", {}, { origin: "http://other.invalid" }), ["mcp"], denied)).status, 403);
  const invalid = await (await handleLiliRequest(request("tools/call", { name: "meta_load_skill", arguments: { skill_name: "../../.env" } }), ["mcp"], denied)).json();
  assert.equal(invalid.result.isError, true);
  assert.ok(!JSON.stringify(invalid).includes("DATABASE_URL"));
  const notified = new Request("http://fixture.invalid/api/lili/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal((await handleLiliRequest(notified, ["mcp"], denied)).status, 202);
});

test("anonymous stage zero reuses original Skills and preserves explicit constraints without market evidence or persistence", async () => {
  const unavailable: LiliAuthorize = async () => { assert.fail("public preparation must not resolve user data"); };
  for (const product of ["arrow bag quiver", "pet travel carrier"]) {
    const requirement = `  产品方向：${product}，采购数量：500件，目标用户：户外用户，目标售价：$35，研究深度：深入  `;
    const response = await handleLiliRequest(request("tools/call", { name: "research_prepare", arguments: { requirement, marketplace: "US" } }), ["mcp"], unavailable);
    const envelope = (await response.json()).result;
    assert.equal(envelope.isError, false);
    const result = JSON.parse(envelope.content[0].text);
    assert.equal(result.stage, 0); assert.equal(result.persisted, false); assert.equal(result.marketDataCollected, false);
    assert.equal(result.brief.productDirection.value, product); assert.equal(result.brief.originalRequirement, requirement);
    assert.equal(result.brief.procurementQuantity.value, 500);
    assert.equal(result.skills.length, 5);
    for (const skill of result.skills) {
      assert.equal(skill.sha256, createHash("sha256").update((await skillMarkdown(skill.name))!).digest("hex"));
      assert.match(skill.source, /^lili:\/\/skills\//);
    }
    assert.equal(result.budget.simulated, false);
    assert.ok(result.budget.stages.every((stage: { estimatedCalls: unknown; credits: unknown; money: unknown; tools: unknown[] }) => stage.estimatedCalls === null && stage.credits === null && stage.money === null && stage.tools.length === 0));
    assert.deepEqual(result.discovery.verifiedSupplierTools, []);
    assert.equal(result.nextAction.kind, "AUTHENTICATE_FOR_DATA");
    assert.equal(result.run, undefined);
  }
});

test("public preparation leaves missing fields unknown and rejects forged scope, credentials and approval arguments", async () => {
  const result = await callPublicResearchTool("research_prepare", { requirement: "研究 any product" });
  assert.equal(result.brief.marketplace, null); assert.ok(result.brief.unresolved.includes("marketplace"));
  assert.equal(result.brief.procurementQuantity, null);
  const forged: ObjectJson[] = [{ workspaceId: "other" }, { approved: true }, { apiKey: "fixture" }];
  for (const extra of forged) {
    await assert.rejects(callPublicResearchTool("research_prepare", { requirement: "fixture", ...extra }));
  }
  await assert.rejects(callPublicResearchTool("research_prepare", { requirement: " " }), /EMPTY_RESEARCH_REQUIREMENT/);
});
