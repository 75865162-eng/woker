import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type AmazonAdsEntityRecord } from "@prisma/client";
import { amazonDataAccess, explicitAmazonDataAccess, assertAmazonScopeAdmin, assertSellerAccess, withAmazonMcpBoundary } from "@/lib/amazon-sync/data-access";
import { amazonAccountReadAccess, AmazonReadError } from "@/lib/amazon-sync/read-account";
import { accountToolsForLili } from "@/lib/lili/account-tool-access";
import { amazonMcpToolDefinitions } from "@/lib/amazon-sync/mcp-tool-registry";
import { amazonBusinessData } from "@/lib/amazon-sync/business-data";
import { adsEntityBusinessFields } from "@/lib/amazon-ads/business-fields";

const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
function fixture() {
  const state = { role: "viewer", active: true, assigned: ["seller-a"], authorization: "CONFIGURED", workspace: true, credential: true };
  const db = {
    organizationMember: { findUnique: async () => ({ role: state.role, user: { status: state.active ? "active" : "disabled" } }) },
    workspaceScope: { findUnique: async () => state.workspace ? { id: scope.workspaceId } : null },
    amazonDataAccessGrant: { findMany: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.userId, "user-a"); assert.equal(where.organizationId, scope.organizationId);
      assert.equal(where.workspaceId, scope.workspaceId); assert.equal(where.enabled, true);
      assert.equal(where.mcpEnabled, undefined); assert.equal(where.actions, undefined);
      return state.assigned.map(sellerAccountId => ({ sellerAccountId, marketplaceIds: ["old-site"], actions: [], mcpEnabled: false }));
    } },
    amazonRoleDataAccessGrant: { findMany: async () => { throw new Error("Read must not use role grants"); } },
    organizationRosterRole: { findMany: async () => { throw new Error("Read must not use module permissions"); } },
    amazonMcpCredential: { findFirst: async () => state.credential ? { id: "credential", name: "fixture", tools: [], scopes: [] } : null },
    amazonSyncDataSource: {
      findFirst: async ({ where }: { where: { id: string } }) => where.id === "source-a" ? { sellerAccountId: "seller-a" } : null,
      findMany: async () => [{ authorization: { status: state.authorization, identityVerifiedAt: new Date() } }],
    },
  } as unknown as Prisma.TransactionClient;
  return { state, db };
}

test("account assignment alone grants all business reads and exports; no role/module/site/MCP grant", async () => {
  const { db } = fixture();
  for (const action of ["view", "export"] as const) {
    assert.deepEqual(await explicitAmazonDataAccess(scope, "user-a", db, action, true), { allSellers: false, sellerIds: ["seller-a"] });
    assert.deepEqual(await amazonDataAccess(scope, "user-a", db, action), { allSellers: false, sellerIds: ["seller-a"] });
  }
});

test("administrator management does not grant unassigned seller reads", async () => {
  const { state, db } = fixture(); state.role = "owner";
  await assertAmazonScopeAdmin(scope, "user-a", db);
  await assert.rejects(assertSellerAccess(scope, "user-a", ["seller-b"], db), /Seller/);
  state.assigned = [];
  await assert.rejects(amazonDataAccess(scope, "user-a", db), /没有已分配/);
  await assertAmazonScopeAdmin(scope, "user-a", db);
  state.role = "viewer";
  await assert.rejects(assertAmazonScopeAdmin(scope, "user-a", db), /管理员/);
});

test("native MCP rechecks credential and assignments, ignoring legacy read tool/site ceilings", async () => {
  const { state, db } = fixture();
  await withAmazonMcpBoundary({ ...scope, userId: "user-a", credentialId: "credential", tool: "finance_get_transactions", action: "view" }, async () => {
    assert.deepEqual((await amazonDataAccess(scope, "user-a", db)).sellerIds, ["seller-a"]);
    state.assigned = [];
    await assert.rejects(amazonDataAccess(scope, "user-a", db), /没有已分配/);
    state.assigned = ["seller-a"]; state.credential = false;
    await assert.rejects(amazonDataAccess(scope, "user-a", db), /不可访问/);
  });
});

test("ERP session boundary checks its own live identity and cannot perform mutations", async () => {
  const { state, db } = fixture();
  await withAmazonMcpBoundary({ ...scope, userId: "user-a", tool: "orders_search", action: "view" }, async () => {
    assert.deepEqual((await amazonDataAccess(scope, "user-a", db)).sellerIds, ["seller-a"]);
    await assert.rejects(amazonDataAccess(scope, "user-a", db, "sync"), /只允许读取/);
    await assert.rejects(amazonDataAccess(scope, "user-b", db), /不可访问/);
    await assert.rejects(amazonDataAccess({ ...scope, workspaceId: "other" }, "user-a", db), /不可访问/);
    state.active = false; await assert.rejects(amazonDataAccess(scope, "user-a", db), /不可访问/);
  });
});

test("business reads require one account and cannot substitute seller/source IDs", async () => {
  const { state, db } = fixture();
  const read = (values: Record<string, string>) => amazonAccountReadAccess(scope, "user-a", new URLSearchParams(values), db, "orders");
  await assert.rejects(read({ sellerAccountId: "seller-b" }), /未分配/);
  await assert.rejects(read({ sourceId: "source-b" }), /不属于/);
  assert.deepEqual((await read({ sourceId: "source-a" })).sellerIds, ["seller-a"]);
  state.assigned.push("seller-b");
  await assert.rejects(read({}), (error: unknown) => error instanceof AmazonReadError && error.businessCode === "ACCOUNT_SCOPE_REQUIRED");
  await assert.rejects(read({ sellerAccountId: "seller-b", sourceId: "source-a" }), /不属于/);
  await assert.rejects(amazonAccountReadAccess(scope, "user-a", new URLSearchParams("sellerAccountId=seller-a&sellerAccountId=seller-b"), db), /只能选择一个/);
  assert.deepEqual((await read({ sellerAccountId: "seller-a", marketplaceId: "new-official-site" })).sellerIds, ["seller-a"]);
});

test("invalid official authorization is explicit and assignment revocation is immediate", async () => {
  const { state, db } = fixture();
  const params = new URLSearchParams({ sellerAccountId: "seller-a" });
  state.authorization = "REVOKED";
  await assert.rejects(amazonAccountReadAccess(scope, "user-a", params, db, "finance"), (error: unknown) => error instanceof AmazonReadError && error.businessCode === "AMAZON_AUTHORIZATION_INVALID");
  state.authorization = "CONFIGURED";
  await amazonAccountReadAccess(scope, "user-a", params, db, "finance");
  state.assigned = [];
  await assert.rejects(amazonAccountReadAccess(scope, "user-a", params, db, "finance"), /没有已分配/);
});

test("ordinary credentials automatically discover Amazon reads without acquiring writes or research", async () => {
  const { db } = fixture();
  const tools = await accountToolsForLili({ id: "credential", tools: [] }, db);
  for (const tool of amazonMcpToolDefinitions.filter(tool => tool.operationMode === "READ_ONLY")) assert.ok(tools.includes(tool.name));
  assert.ok(!tools.includes("data_sync_start")); assert.ok(!tools.includes("research_confirm"));
});

test("new and nested ad business fields survive; secrets are removed independently of users", () => {
  const payload = { futureField: false, placement: { adjustment: 25, refresh_token: "secret" }, values: [0, null, { newMetric: "1.00001" }], clientSecret: "secret", credentialsCiphertext: "secret", accessToken: "secret" };
  const safe = amazonBusinessData(payload);
  assert.deepEqual(safe, { futureField: false, placement: { adjustment: 25 }, values: [0, null, { newMetric: "1.00001" }] });
  const row = { payload, entityType: "SP:keyword", bid: new Prisma.Decimal("0.123456789"), name: null, budgetAmount: null, budgetType: null, targetingExpression: null } as unknown as AmazonAdsEntityRecord;
  const fields = adsEntityBusinessFields(row);
  assert.equal(fields.bid, "0.123456789"); assert.equal(fields.futureField, false);
  assert.deepEqual(fields.placement, { adjustment: 25 }); assert.equal(fields.accessToken, undefined);
});
