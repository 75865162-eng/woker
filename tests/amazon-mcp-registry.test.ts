import assert from "node:assert/strict";
import test from "node:test";
import { amazonMcpToolDefinitions, amazonMcpTools, amazonMcpSyncResources, bindAmazonMcpHandlers, hasReimbursementAnalysisReadPath, isCallableAmazonMcpTool, mcpDiscoveryDescriptor, validateAmazonMcpDefinitions, fixedAmazonMcpDataset, skillBusinessDatasetTools, type AmazonMcpToolName } from "../src/lib/amazon-sync/mcp-tool-registry";

const handlers = () => Object.fromEntries(amazonMcpToolDefinitions.map(tool => [tool.name, async () => tool.name])) as Record<AmazonMcpToolName, () => Promise<string>>;

test("catalog binds every legacy and business tool without adding an internal Agent capability", async () => {
  const bound = bindAmazonMcpHandlers(handlers());
  assert.equal(bound.length, amazonMcpTools.length);
  assert.equal(new Set(bound.map(tool => tool.name)).size, bound.length);
  assert.deepEqual(bound.map(tool => [tool.name, tool.description]), amazonMcpTools);
  for (const tool of bound) {
    assert.equal(await tool.handler(undefined), tool.name);
    assert.equal(tool.implementationStatus, "IMPLEMENTED");
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.outputSchema.type);
    assert.ok(!tool.name.startsWith("product."));
  }
});

test("business tools pin their real dataset and retain independent grants and date semantics", () => {
  assert.equal(Object.keys(skillBusinessDatasetTools).length, 10);
  for (const [name, dataset] of Object.entries(skillBusinessDatasetTools)) {
    const tool = amazonMcpToolDefinitions.find(item => item.name === name)!;
    assert.equal(fixedAmazonMcpDataset(name), dataset);
    assert.equal(tool.canonicalName, name);
    assert.equal(tool.operationMode, "READ_ONLY");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal((tool.inputSchema.properties as Record<string, unknown>).table, undefined);
    assert.equal((tool.inputSchema.properties as Record<string, unknown>).sql, undefined);
    assert.ok((tool.inputSchema.required as string[]).includes("sellerAccountId"));
    assert.ok((tool.inputSchema.required as string[]).includes("marketplaceId"));
  }
});

test("reimbursement analysis accepts either all dedicated readers or the scoped generic query tool", () => {
  assert.equal(hasReimbursementAnalysisReadPath(["reimbursement_get_events", "reimbursement_get_payments", "finance_get_transactions"]), true);
  assert.equal(hasReimbursementAnalysisReadPath(["data_query"]), true);
  assert.equal(hasReimbursementAnalysisReadPath(["reimbursement_get_events", "reimbursement_get_payments"]), false);
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
  assert.deepEqual(amazonMcpSyncResources, ["inventory", "catalog", "sales_traffic", "orders", "finance", "settlements", "reimbursements", "returns", "inventory_age", "inventory_events", "fulfillment", "catalog_items", "listing_details", "promotions"]);
  const resourceSchema = (request.inputSchema.properties as Record<string, { enum?: string[] }>).resource;
  assert.deepEqual(resourceSchema.enum, amazonMcpSyncResources);
  const eventTypeSchema = (request.inputSchema.properties as Record<string, { enum?: string[] }>).eventType;
  assert.deepEqual(eventTypeSchema.enum, ["", "Adjustments", "CustomerReturns", "Receipts", "Shipments", "VendorReturns", "WhseTransfers"]);
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
  assert.deepEqual(query.inputSchema.anyOf, [{ required: ["table"] }, { required: ["tableName"] }, { required: ["module", "dataType"] }]);
});
