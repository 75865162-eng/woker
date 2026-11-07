import assert from "node:assert/strict";
import test from "node:test";
import { amazonMcpToolDefinitions, amazonMcpTools, bindAmazonMcpHandlers, isCallableAmazonMcpTool, mcpDiscoveryDescriptor, validateAmazonMcpDefinitions, type AmazonMcpToolName } from "../src/lib/amazon-sync/mcp-tool-registry";

const handlers = () => Object.fromEntries(amazonMcpToolDefinitions.map(tool => [tool.name, async () => tool.name])) as Record<AmazonMcpToolName, () => Promise<string>>;

test("catalog binds all 21 legacy tool names without adding an internal Agent capability", async () => {
  const bound = bindAmazonMcpHandlers(handlers());
  assert.equal(bound.length, 21);
  assert.equal(new Set(bound.map(tool => tool.name)).size, 21);
  assert.deepEqual(bound.map(tool => [tool.name, tool.description]), amazonMcpTools);
  for (const tool of bound) {
    assert.equal(await tool.handler(undefined), tool.name);
    assert.equal(tool.implementationStatus, "IMPLEMENTED");
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.outputSchema.type);
    assert.ok(!tool.name.startsWith("product."));
  }
});

test("registration rejects duplicate names, missing handlers, orphan handlers and invalid aliases", () => {
  assert.throws(() => validateAmazonMcpDefinitions([...amazonMcpToolDefinitions, amazonMcpToolDefinitions[0]]), /Duplicate/);
  const missing = handlers();
  delete (missing as Partial<typeof missing>)["data_query"];
  assert.throws(() => bindAmazonMcpHandlers(missing), /Missing/);
  assert.throws(() => bindAmazonMcpHandlers({ ...handlers(), unknown: async () => "unknown" } as ReturnType<typeof handlers>), /Orphan/);
  assert.throws(() => validateAmazonMcpDefinitions([{ ...amazonMcpToolDefinitions[0], canonicalName: "missing" as AmazonMcpToolName }]), /alias/);
  assert.throws(() => validateAmazonMcpDefinitions([{ ...amazonMcpToolDefinitions[0], inputSchema: { type: "string" } }]), /schema/);
});

test("aliases retain independent names and sync creation is explicitly an approval request", () => {
  const alias = amazonMcpToolDefinitions.find(tool => tool.name === "ads_list_entities")!;
  assert.equal(alias.canonicalName, "amazon.ads.entities.list");
  assert.equal(alias.action, "view");
  assert.notEqual(alias.name, alias.canonicalName);
  const request = amazonMcpToolDefinitions.find(tool => tool.name === "data_sync_start")!;
  assert.equal(request.operationMode, "APPROVAL_REQUEST");
  assert.ok(request.requiredPermissions.includes("operations:create"));
  assert.equal(mcpDiscoveryDescriptor(request, null).annotations.readOnlyHint, false);
  assert.equal(isCallableAmazonMcpTool({ ...request, enabled: false }), false);
});

test("legacy discovery retains input contracts and newer discovery describes structured outputs truthfully", () => {
  for (const tool of amazonMcpToolDefinitions) {
    const legacy = mcpDiscoveryDescriptor(tool, "2024-11-05");
    assert.equal(legacy.outputSchema, undefined);
    assert.equal(legacy._meta, undefined);
    const modern = mcpDiscoveryDescriptor(tool, "2025-06-18");
    assert.equal(modern._meta?.["erp/toolVersion"], tool.version);
    assert.equal(modern._meta?.["erp/dataAvailability"], "NOT_CHECKED");
    assert.equal(modern.outputSchema?.type, tool.outputSchema.type === "object" ? "object" : undefined);
  }
  const query = amazonMcpToolDefinitions.find(tool => tool.name === "data_query")!;
  assert.deepEqual(query.inputSchema.anyOf, [{ required: ["table"] }, { required: ["module", "dataType"] }]);
});
