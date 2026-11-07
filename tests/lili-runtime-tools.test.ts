import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeTools } from "@/lib/lili/runtime-tools";
import type { ToolDefinition } from "@/lib/selection-research/types";
const schema = { type: "object", properties: { asin: { type: "string" } }, required: ["asin"] };

test("a stalled provider cannot prevent discovery of connected ERP tools or Skill loading", async () => {
  let aborted = false;
  const runtime = createRuntimeTools([
    { id: "erp", isReadOnly: () => true, transport: { async listTools() { return [{ name: "data_query", inputSchema: schema }]; }, async callTool() { return {}; } } },
    { id: "xiyou", isReadOnly: () => true, transport: { async listTools(signal) { signal?.addEventListener("abort", () => { aborted = true; }); return new Promise(() => undefined); }, async callTool() { throw new Error("unreachable"); } } },
  ], { discoveryTimeoutMs: 10 });
  const result = await runtime.discover();
  assert.equal(result.providers.find(provider => provider.provider === "erp")?.status, "connected");
  assert.equal(result.providers.find(provider => provider.provider === "xiyou")?.status, "unavailable");
  assert.equal(aborted, true);
  assert.ok(result.tools.some(tool => tool.name === "erp__data_query"));
  const skill = await runtime.call("meta_load_skill", { skill_name: "amazon-product-research" }, new AbortController().signal) as { markdown: string };
  assert.ok(skill.markdown.length > 500);
});

test("runtime discovery exposes actual schemas and permissions, isolates disconnected sources and never substitutes shipped business tools", async () => {
  let dispatched = 0;
  const tool: ToolDefinition = { name: "actual_read", description: "live definition", inputSchema: schema, annotations: { readOnlyHint: true } };
  const runtime = createRuntimeTools([
    { id: "erp", isReadOnly: tool => tool.annotations?.readOnlyHint === true, transport: { async listTools() { return [tool, { ...tool, name: "actual_write", annotations: { readOnlyHint: false } }]; }, async callTool(name, args) { dispatched++; return { name, args }; } } },
    { id: "sellersprite", isReadOnly: () => true, transport: { async listTools() { throw new Error("private provider failure"); }, async callTool() { throw new Error("unreachable"); } } },
    { id: "xiyou", isReadOnly: () => true, reason: "TOKEN_REQUIRED" },
  ]);
  const discovery = await runtime.discover();
  assert.deepEqual(discovery.providers.map(p => p.status), ["connected", "unavailable", "not_connected"]);
  assert.equal(discovery.tools.length, 5);
  assert.deepEqual(discovery.tools.find(t => t.name === "erp__actual_read")?.inputSchema, schema);
  assert.equal(discovery.tools.find(t => t.name === "erp__actual_write")?.permission, "approval_required");
  assert.ok(!JSON.stringify(discovery).includes("private provider failure"));
  await assert.rejects(runtime.call("erp__actual_write", { asin: "B000000001" }, new AbortController().signal));
  await assert.rejects(runtime.call("erp__actual_read", {}, new AbortController().signal));
  assert.equal(dispatched, 0);
  assert.deepEqual(await runtime.call("erp__actual_read", { asin: "B000000001" }, new AbortController().signal, schema), { name: "actual_read", args: { asin: "B000000001" } });
  assert.equal(dispatched, 1);
});

test("dispatch rechecks revocation and schema drift; real skill bodies load without business calls", async () => {
  let registry: ToolDefinition[] = [{ name: "read", inputSchema: schema }];
  let calls = 0;
  const runtime = createRuntimeTools([{ id: "erp", isReadOnly: () => true, transport: { async listTools() { return registry; }, async callTool() { calls++; return {}; } } }]);
  await assert.rejects(runtime.call("erp__read", { asin: "B000000001" }, new AbortController().signal, { type: "object" }), /SCHEMA_CHANGED/);
  registry = [];
  await assert.rejects(runtime.call("erp__read", { asin: "B000000001" }, new AbortController().signal), /FORBIDDEN/);
  const skill = await runtime.call("meta_load_skill", { skill_name: "amazon-product-research" }, new AbortController().signal) as { markdown: string };
  assert.ok(skill.markdown.length > 500); assert.equal(calls, 0);
  await assert.rejects(runtime.call("meta_load_skill", { skill_name: "missing-skill" }, new AbortController().signal), /INVALID_TOOL_ARGUMENTS/);
  await assert.rejects(runtime.call("meta_search_skills", { query: " " }, new AbortController().signal), /INVALID_TOOL_ARGUMENTS/);
});

test("runtime schema approval ignores object key order but blocks changed constraints before dispatch", async () => {
  let calls = 0;
  const runtime = createRuntimeTools([{ id: "erp", isReadOnly: () => true, transport: {
    async listTools() { return [{ name: "read", inputSchema: schema }]; },
    async callTool() { calls++; return { requestId: "isolated" }; },
  } }]);
  const reordered = { required: ["asin"], properties: { asin: { type: "string" } }, type: "object" };
  await runtime.call("erp__read", { asin: "B000000001" }, new AbortController().signal, reordered);
  assert.equal(calls, 1);
  await assert.rejects(runtime.call("erp__read", { asin: "B000000001" }, new AbortController().signal, { ...reordered, additionalProperties: false }), /APPROVED_SCHEMA_CHANGED/);
  assert.equal(calls, 1);
});

test("Lili JSON-RPC lists injected live adapters and dispatches using the exact namespaced schema", async () => {
  const { handleLiliRequest } = await import("@/lib/lili/api");
  const runtime = createRuntimeTools([{ id: "erp", isReadOnly: () => true, transport: { async listTools() { return [{ name: "data_query", inputSchema: schema, annotations: { readOnlyHint: true } }]; }, async callTool(name, args) { return { name, args, requestId: "isolated-request" }; } } }]);
  const request = (method: string, params = {}) => new Request("http://lili.invalid/api/lili/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "isolated-rpc", method, params }) });
  const auth = async () => ({ ok: true as const });
  const listed = await (await handleLiliRequest(request("tools/list"), ["mcp"], auth, undefined, runtime)).json();
  assert.equal(listed.result.tools.find((tool: { name: string }) => tool.name === "erp__data_query").permission, "read");
  const called = await (await handleLiliRequest(request("tools/call", { name: "erp__data_query", arguments: { asin: "B000000001" } }), ["mcp"], auth, undefined, runtime)).json();
  assert.equal(called.result.isError, false);
  assert.equal(JSON.parse(called.result.content[0].text).requestId, "isolated-request");
  const invalidRequest = new Request("http://lili.invalid/api/lili/tools/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "erp__data_query", input: { unexpected: "private-input-must-not-echo" } }) });
  const rejected = await handleLiliRequest(invalidRequest, ["tools", "run"], auth, undefined, runtime);
  assert.equal(rejected.status, 400);
  const invalid = await rejected.json();
  assert.equal(invalid.error, "INVALID_TOOL_ARGUMENTS");
  assert.ok(!JSON.stringify(invalid).includes("private-input"));
});

test("research validator accepts actual ERP conditional dataset schema and enforces dataset bounds", async () => {
  const { validate } = await import("@/lib/selection-research/schema");
  const { amazonMcpToolDefinitions } = await import("@/lib/amazon-sync/mcp-tool-registry");
  const inputSchema = amazonMcpToolDefinitions.find(tool => tool.name === "data_query")!.inputSchema;
  validate(inputSchema as never, { table: "inventory", pageSize: 3 });
  assert.throws(() => validate(inputSchema as never, { module: "inventory" }));
  assert.throws(() => validate(inputSchema as never, { table: "inventory", pageSize: 10000 }));
  assert.throws(() => validate(inputSchema as never, { table: "inventory", sql: "select *" }));
  assert.throws(() => validate({ type: "string", format: "date" }, "2026-02-30"));
});

test("observed SellerSprite dotted names map to reviewed read policies and real schema constraints remain enforced", async () => {
  const { sellerSpritePolicy } = await import("@/lib/selection-research/seller-transport");
  const { validate } = await import("@/lib/selection-research/schema");
  const { xiyouResearchReadTools } = await import("@/lib/lili/runtime-tools");
  assert.equal(sellerSpritePolicy({ name: "sellersprite__asin.detail" })?.provider, "sellersprite");
  assert.equal(sellerSpritePolicy({ name: "asin.review.list" })?.paid, true);
  assert.equal(sellerSpritePolicy({ name: "unknown.write" }), null);
  assert.ok(xiyouResearchReadTools.has("get_asin_info"));
  assert.ok(!xiyouResearchReadTools.has("generate_category_insight_resource"));
  const schema = { type: "array", uniqueItems: true, items: { type: "string", pattern: "^B[0-9A-Z]{9}$", examples: ["B000000001"] } };
  validate(schema, ["B000000001"]);
  assert.throws(() => validate(schema, ["B000000001", "B000000001"]));
  assert.throws(() => validate(schema, ["invalid"]));
  validate({ type: ["string", "null"] }, null);
  assert.throws(() => validate({ type: ["string", "null"] }, 1));
});
