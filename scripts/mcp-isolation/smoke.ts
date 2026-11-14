/**
 * MCP 提供方隔离冒烟：真实库内创建一张赛狐凭证，验证
 *   1) 赛狐凭证只能在赛狐端点认证；
 *   2) Amazon 凭证在赛狐端点被拒绝（PROVIDER_MISMATCH）；
 *   3) 跨提供方数据集被拒绝（DATASET_NOT_ALLOWED），不会触达 SQL；
 *   4) 未授权工具被拒绝（TOOL_NOT_ALLOWED）。
 * 不调用任何外部 Amazon/赛狐 API。结束后吊销凭证。
 *
 * 用法：node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs scripts/mcp-isolation/smoke.ts
 */
import { prisma } from "@/lib/db/prisma";
import { McpIsolationError } from "@/lib/mcp/isolation";
import { authenticateSellfoxMcp, invokeSellfoxMcp, manageSellfoxMcpCredential } from "@/lib/sellfox/mcp";
import { sellfoxMcpToolNames } from "@/lib/sellfox/mcp-tool-registry";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof McpIsolationError, `expected McpIsolationError, got ${String(error)}`);
    assert(error.code === code, `expected ${code}, got ${error.code}`);
    return error;
  }
  throw new Error(`ASSERT: expected ${code}, nothing was thrown`);
}

async function main() {
  const [owner] = await prisma.$queryRaw<Array<{ organizationId: string; id: string }>>`
    SELECT m."organizationId", m."userId" AS id FROM "OrganizationMember" m ORDER BY m."createdAt" ASC LIMIT 1`;
  assert(owner, "数据库中没有带组织的用户");
  const scope = { organizationId: owner.organizationId, workspaceId: "default" };

  const created = await manageSellfoxMcpCredential(scope, owner.id, {
    action: "create", name: "smoke-isolation", tools: [...sellfoxMcpToolNames], storeIds: [],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  assert(created.token?.startsWith("sfmcp_"), "新凭证令牌必须以 sfmcp_ 开头");
  try {
    const identity = await authenticateSellfoxMcp(`Bearer ${created.token}`);
    assert(identity.organizationId === scope.organizationId, "凭证组织必须来自凭证行");
    assert(identity.kind === "credential", "应为数据库凭证");

    await expectCode(authenticateSellfoxMcp(`Bearer amcp_${"a".repeat(43)}`), "PROVIDER_MISMATCH");
    await expectCode(invokeSellfoxMcp(identity, "sellfox.query_data", { dataset: "AmazonSyncDataSource" }), "DATASET_NOT_ALLOWED");
    await expectCode(invokeSellfoxMcp(identity, "amazon.stores.list", {}), "TOOL_NOT_ALLOWED");

    const store = await prisma.sellfoxStore.findFirst({ where: scope, select: { id: true } });
    if (store) {
      const limited = await manageSellfoxMcpCredential(scope, owner.id, {
        action: "create", name: "smoke-store-fence", tools: ["sellfox.query_data"], storeIds: [store.id],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const limitedIdentity = await authenticateSellfoxMcp(`Bearer ${limited.token}`);
      assert(limitedIdentity.storeScope.length === 1, "凭证店铺围栏应只含一个店铺");
      await expectCode(invokeSellfoxMcp(limitedIdentity, "sellfox.query_data", { dataset: "orders", storeId: "not-a-store" }), "STORE_NOT_ALLOWED");
      await manageSellfoxMcpCredential(scope, owner.id, { action: "revoke", id: limited.credential.id, revision: limited.credential.revision });
    } else {
      console.log("SKIP store fence: 当前组织没有赛狐店铺");
    }
    console.log("OK provider mismatch / dataset / tool / store fence");

    // HTTP 层：证书与端点绑定的实际表现（直接调用 Route Handler，不依赖已构建的 .next）。
    const { POST } = await import("@/app/api/mcp/sellfox/route");
    const rpc = (token: string, body: unknown) => POST(new Request("http://localhost/api/mcp/sellfox", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    const crossProvider = await rpc(`amcp_${"a".repeat(43)}`, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert(crossProvider.status === 401, `Amazon 凭证访问赛狐端点应 401，实际 ${crossProvider.status}`);
    const list = await rpc(created.token!, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert(list.status === 200, `赛狐 tools/list 应 200，实际 ${list.status}`);
    const listed = await list.json() as { result?: { tools?: Array<{ name: string }> } };
    assert(listed.result?.tools?.every(tool => tool.name.startsWith("sellfox.")), "tools/list 必须只返回 sellfox.* 工具");
    const crossDataset = await rpc(created.token!, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "sellfox.query_data", arguments: { dataset: "AmazonSyncDataSource" } } });
    assert(crossDataset.status === 403, `跨提供方数据集应 403，实际 ${crossDataset.status}`);
    const body = await crossDataset.json() as { error?: { data?: { businessCode?: string } } };
    assert(body.error?.data?.businessCode === "DATASET_NOT_ALLOWED", `应返回 DATASET_NOT_ALLOWED，实际 ${body.error?.data?.businessCode}`);
    console.log("OK HTTP provider binding + tools/list namespace + dataset fence");

    if (process.env.MCP_HTTP_TOKEN && process.env.MCP_ORG_ID && process.env.MCP_DISABLE_SHARED_TOKEN !== "true") {
      const shared = await authenticateSellfoxMcp(`Bearer ${process.env.MCP_HTTP_TOKEN}`);
      assert(shared.kind === "shared-env", "兼容共享令牌应解析为 shared-env 身份");
      assert(shared.organizationId === process.env.MCP_ORG_ID, "共享令牌必须绑定 MCP_ORG_ID");
      console.log("OK legacy shared token is sellfox-only and org-bound");
    }
  } finally {
    await manageSellfoxMcpCredential(scope, owner.id, { action: "revoke", id: created.credential.id, revision: created.credential.revision });
  }
  console.log("OK sellfox credential lifecycle");
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
