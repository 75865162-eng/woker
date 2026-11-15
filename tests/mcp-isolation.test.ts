import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertCredentialStores, assertCredentialTool, assertEndpointProvider, assertProviderDataset,
  assertProviderTable, bearerToken, McpIsolationError, mcpIsolationMatrix, mcpProviderPolicies, providerOfToken,
} from "../src/lib/mcp/isolation";
import { amazonMcpToolDefinitions } from "../src/lib/amazon-sync/mcp-tool-registry";
import {
  normalizeSellfoxToolGrants, sellfoxDataset, sellfoxDatasetKeys, sellfoxDatasets,
  sellfoxDiscoverableTools, sellfoxLegacyToolAliases, sellfoxMcpToolDefinitions, sellfoxMcpToolNames, sellfoxTableAllowList,
} from "../src/lib/sellfox/mcp-tool-registry";

const AMAZON_TOKEN = `amcp_${"a".repeat(43)}`;
const SELLFOX_TOKEN = `sfmcp_${"b".repeat(43)}`;

test("token prefix decides the provider and prefixes never collide", () => {
  assert.equal(providerOfToken(AMAZON_TOKEN), "amazon");
  assert.equal(providerOfToken(SELLFOX_TOKEN), "sellfox");
  assert.equal(providerOfToken("glpat-abcdefgh"), null);
  assert.equal(providerOfToken(null), null);
  assert.notEqual(mcpProviderPolicies.amazon.tokenPrefix, mcpProviderPolicies.sellfox.tokenPrefix);
  assert.ok(AMAZON_TOKEN.length > 20 && SELLFOX_TOKEN.length > 20);
});

test("bearer parsing rejects schemes and blank tokens", () => {
  assert.equal(bearerToken(`Bearer ${AMAZON_TOKEN}`), AMAZON_TOKEN);
  assert.equal(bearerToken(`bearer ${AMAZON_TOKEN}`), null);
  assert.equal(bearerToken("Bearer  "), null);
  assert.equal(bearerToken(null), null);
});

test("a credential issued by one provider is rejected by the other endpoint", () => {
  assert.doesNotThrow(() => assertEndpointProvider("sellfox", "sellfox"));
  assert.doesNotThrow(() => assertEndpointProvider("amazon", "amazon"));
  for (const [endpoint, credential] of [["sellfox", "amazon"], ["amazon", "sellfox"]] as const) {
    assert.throws(
      () => assertEndpointProvider(endpoint, credential),
      error => error instanceof McpIsolationError && error.code === "PROVIDER_MISMATCH" && error.status === 401,
    );
  }
  assert.throws(() => assertEndpointProvider("sellfox", null), error => error instanceof McpIsolationError && error.code === "UNKNOWN_TOKEN_PREFIX");
});

test("sellfox datasets are a closed list of Sellfox* tables", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  for (const dataset of Object.values(sellfoxDatasets)) {
    assert.ok(dataset.table.startsWith("Sellfox"), dataset.table);
    assert.ok(sellfoxTableAllowList.includes(dataset.table));
    assertProviderTable("sellfox", dataset.table, sellfoxTableAllowList);
    const model = schema.match(new RegExp(`model ${dataset.table} \\{([\\s\\S]*?)^\\}`, "m"))?.[1];
    assert.ok(model, `Missing Prisma model ${dataset.table}`);
    for (const column of dataset.columns) {
      const field = column.replaceAll('"', "");
      assert.match(model!, new RegExp(`^\\s*${field}\\s`, "m"), `${dataset.key}.${field} is not a Prisma field`);
    }
    assert.match(model!, new RegExp(`^\\s*${dataset.dateField}\\s`, "m"), `${dataset.key}.${dataset.dateField} is not a Prisma field`);
  }
  assert.deepEqual(sellfoxDatasetKeys.filter(key => key.includes("amazon")), []);
});

test("sellfox MCP trend and inventory diagnostics preserve current and complete data semantics", () => {
  const runtime = readFileSync(fileURLToPath(new URL("../src/lib/sellfox/mcp.ts", import.meta.url)), "utf8");
  assert.match(runtime, /FROM "sellfox_sales_daily" s/);
  assert.match(runtime, /bool_and\(s\.complete\)/);
  assert.match(runtime, /FROM "sellfox_inventory_current"/);
  assert.match(runtime, /st\.on_hand IS NOT NULL/);
  assert.doesNotMatch(runtime, /COALESCE\(st\.on_hand, 0\)/);
  assert.doesNotMatch(runtime, /COALESCE\(tg\.in_transit, 0\)/);
  assert.doesNotMatch(runtime, /s\."orderNum"|s\."salePrice"/);
});

test("sellfox cannot name Amazon tables or datasets", () => {
  for (const name of ["AmazonSyncDataSource", "AmazonAdsProfile", "PublicAmazonOrder", "SellfoxStore; DROP TABLE"]) {
    assert.throws(() => assertProviderTable("sellfox", name, sellfoxTableAllowList), error => error instanceof McpIsolationError && error.code === "TABLE_NOT_ALLOWED");
  }
  for (const dataset of ["order_items", "ads_report_daily", "ads_entities", "amazon_orders", "inventory_age"]) {
    assert.throws(() => assertProviderDataset("sellfox", dataset, sellfoxDatasetKeys), error => error instanceof McpIsolationError && error.code === "DATASET_NOT_ALLOWED");
  }
  assert.doesNotThrow(() => sellfoxDataset("sales"));
  assert.throws(() => sellfoxDataset("amazon_orders"));
});

test("sellfox tool names are namespaced and never overlap Amazon tools", () => {
  const amazon = new Set<string>(amazonMcpToolDefinitions.map(tool => tool.name));
  for (const tool of sellfoxMcpToolDefinitions) {
    assert.ok(tool.name.startsWith("sellfox."), tool.name);
    assert.equal(amazon.has(tool.name), false, tool.name);
    assert.equal(tool.operationMode, "READ_ONLY");
  }
  for (const alias of Object.keys(sellfoxLegacyToolAliases)) assert.equal(amazon.has(alias), false, alias);
  assert.equal(sellfoxMcpToolNames.length, sellfoxMcpToolDefinitions.length);
});

test("legacy sellfox aliases resolve to canonical tools and unknown tools are refused", () => {
  assert.equal(normalizeSellfoxToolGrants(["query_data", "sellfox.sales_trend"]).includes("sellfox.query_data"), true);
  assert.throws(() => normalizeSellfoxToolGrants(["data_query"]), error => error instanceof McpIsolationError && error.code === "TOOL_NOT_ALLOWED");
  assert.throws(() => normalizeSellfoxToolGrants(["amazon.stores.list"]), error => error instanceof McpIsolationError);
});

test("credential grants filter discovery one-to-one", () => {
  assert.deepEqual(sellfoxDiscoverableTools(["query_data"]).map(tool => tool.name), ["sellfox.query_data"]);
  assert.equal(sellfoxDiscoverableTools(sellfoxMcpToolNames).length, sellfoxMcpToolDefinitions.length);
  assert.equal(sellfoxDiscoverableTools([]).length, 0);
});

test("store fence is an intersection, never a union with request input", () => {
  assert.doesNotThrow(() => assertCredentialStores("sellfox", ["store-a", "store-b"], ["store-a"]));
  assert.doesNotThrow(() => assertCredentialStores("sellfox", ["store-a"], []));
  assert.doesNotThrow(() => assertCredentialStores("sellfox", ["*"], ["store-z"]));
  assert.throws(() => assertCredentialStores("sellfox", ["store-a"], ["store-b"]), error => error instanceof McpIsolationError && error.code === "STORE_NOT_ALLOWED");
});

test("tool grants are checked against the credential, not the global catalog", () => {
  assert.doesNotThrow(() => assertCredentialTool("sellfox", ["sellfox.query_data"], "sellfox.query_data"));
  assert.throws(() => assertCredentialTool("sellfox", ["sellfox.query_data"], "sellfox.stores.list"), error => error instanceof McpIsolationError && error.code === "TOOL_NOT_ALLOWED");
});

test("isolation matrix exposes separate endpoints, roles and audit prefixes", () => {
  const [amazon, sellfox] = mcpIsolationMatrix({ MCP_PG_READONLY_URL: "postgres://x" });
  assert.equal(amazon.endpoint, "/api/mcp/amazon");
  assert.equal(sellfox.endpoint, "/api/mcp/sellfox");
  assert.notEqual(amazon.dbRole, sellfox.dbRole);
  assert.notEqual(amazon.auditPrefix, sellfox.auditPrefix);
  assert.equal(sellfox.dbRoleConfigured, true);
  assert.equal(amazon.dbRoleConfigured, false);
});
