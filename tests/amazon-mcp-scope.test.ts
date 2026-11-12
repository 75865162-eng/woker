import assert from "node:assert/strict";
import test from "node:test";
import { assertAmazonMcpScope } from "../src/lib/amazon-sync/mcp-scope";
import { amazonMcpToolDefinitions } from "../src/lib/amazon-sync/mcp-tool-registry";
import { SyncInputError } from "../src/lib/amazon-sync/policy";

const pair = { sellerAccountId: "seller-a", marketplaceId: "market-us" };
const denied = (tool: string, args: Record<string, unknown>) => assert.throws(
  () => assertAmazonMcpScope(tool, args),
  error => error instanceof SyncInputError && error.status === 403,
);

test("every business tool and alias requires one explicit account and marketplace", () => {
  for (const tool of amazonMcpToolDefinitions.filter(tool => tool.name !== "amazon.stores.list")) {
    assert.doesNotThrow(() => assertAmazonMcpScope(tool.name, pair));
    for (const args of [{}, { sellerAccountId: pair.sellerAccountId }, { marketplaceId: pair.marketplaceId },
      { ...pair, sellerAccountIds: ["seller-a", "seller-b"] }, { ...pair, sellerAccountIds: ["seller-a"] },
      { sourceId: "previously-authorized-source" }, { profileId: "previously-authorized-profile" }]) denied(tool.name, args);
    assert.ok((tool.inputSchema.required as string[]).includes("sellerAccountId"), tool.name);
    assert.ok((tool.inputSchema.required as string[]).includes("marketplaceId"), tool.name);
    assert.equal((tool.inputSchema.properties as Record<string, unknown>).sellerAccountIds, undefined);
    assert.equal(tool.version, "2.0.0");
  }
});

test("scope cannot be an array, object, blank, padded or oversized identifier", () => {
  for (const key of ["sellerAccountId", "marketplaceId"]) {
    for (const value of [null, undefined, "", " ", " seller-a", "market-us ", ["a", "b"], { in: ["a", "b"] }, 1, "x".repeat(201)]) {
      denied("data_query", { ...pair, [key]: value });
    }
  }
});

test("identity discovery can run before selecting a business scope", () => {
  assert.doesNotThrow(() => assertAmazonMcpScope("amazon.stores.list", {}));
  const discovery = amazonMcpToolDefinitions.find(tool => tool.name === "amazon.stores.list")!;
  assert.equal(discovery.inputSchema.required, undefined);
});
