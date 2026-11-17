import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { amazonMcpToolDefinitions } from "../src/lib/amazon-sync/mcp-tool-registry";
import { sellfoxDatasets } from "../src/lib/sellfox/mcp-tool-registry";
import { amazonLocalRawTables } from "../src/lib/amazon-sync/local-raw-catalog";

/**
 * 第五节 5 个待拍板点的定案（2026-11-15）。
 * 结论本身写在 output/承接池定义审计与修改规划_2026-11-14.md 第十章；
 * 这里把「不该漂移」的部分固化为可执行约束，防止后续改动无意推翻决策。
 */
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const schema = read("../prisma/schema.prisma");
const sellfoxMcp = read("../src/lib/sellfox/mcp.ts");
const amazonRegistry = read("../src/lib/amazon-sync/mcp-tool-registry.ts");
const amazonRead = read("../src/lib/amazon-sync/local-raw-read.ts");

test("决策 1：data_sync_start 保留，但只能是审批申请，不能伪装成只读或写业务表", () => {
  const definition = amazonMcpToolDefinitions.find(tool => tool.name === "data_sync_start");
  assert.ok(definition, "data_sync_start 不应被移除：它是「授权 → 同步」链路的申请入口");
  assert.equal(definition!.operationMode, "APPROVAL_REQUEST");
  assert.notEqual(definition!.operationMode, "READ_ONLY");
  assert.match(definition!.description, /审批/);
  assert.match(amazonRegistry, /action === "sync" \? "APPROVAL_REQUEST"/);
});

test("环境共享令牌不能认证，持久化个人凭证保留组织工作区与店铺范围", async () => {
  const { authenticateSellfoxMcp } = await import("../src/lib/sellfox/mcp");
  const { mcpTokenHash } = await import("../src/lib/mcp/token");
  const globals = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globals.prisma, previousToken = process.env.MCP_HTTP_TOKEN;
  let reads = 0, updates = 0;
  const token = "sfmcp_personal-fixture";
  const row = { id: "credential", organizationId: "org", workspaceId: "workspace", userId: "owner", name: "个人只读凭证", tokenPrefix: "sfmcp_", tools: [], storeIds: ["store"], scopes: [], status: "ACTIVE", revision: 1, expiresAt: new Date(Date.now() + 60000), lastUsedAt: null };
  globals.prisma = { auditLog: { create: async () => ({}) }, sellfoxMcpCredential: { findUnique: async ({ where }: { where: { tokenHash: string } }) => { reads++; return where.tokenHash === mcpTokenHash(token) ? row : null; }, update: async () => { updates++; return row; } } };
  process.env.MCP_HTTP_TOKEN = "shared-fixture";
  try {
    await assert.rejects(authenticateSellfoxMcp("Bearer shared-fixture"));
    assert.equal(reads, 0);
    process.env.MCP_HTTP_TOKEN = "sfmcp_unpersisted-shared";
    await assert.rejects(authenticateSellfoxMcp("Bearer sfmcp_unpersisted-shared"));
    assert.equal(updates, 0);
    const identity = await authenticateSellfoxMcp(`Bearer ${token}`);
    assert.equal(identity.kind, "credential");
    assert.deepEqual(identity.storeScope, ["store"]);
    assert.equal(identity.organizationId, "org");
    assert.equal(identity.workspaceId, "workspace");
    assert.equal(updates, 1);
  } finally {
    globals.prisma = previousDb;
    if (previousToken === undefined) delete process.env.MCP_HTTP_TOKEN; else process.env.MCP_HTTP_TOKEN = previousToken;
  }
});

test("决策 3：赛狐 API 授权维持组织+工作区粒度，不按店铺拆表", () => {
  const block = schema.match(/^model SellfoxIntegrationCredential\s*\{([\s\S]*?)^\}/m);
  assert.ok(block, "赛狐 API 凭证模型必须存在");
  assert.match(block[1], /@@id\(\[organizationId, workspaceId\]\)/);
  assert.doesNotMatch(block[1], /storeId/, "按店铺拆分会破坏现有账号级授权；店铺围栏由 MCP 凭证 storeIds 承担");
  assert.ok(Object.values(sellfoxDatasets).every(dataset => dataset.table.startsWith("Sellfox")));
});

test("决策 4：ProductRecord 是上层共享主档，不属于任一承接池，也不进任何 MCP 目录", () => {
  assert.ok(!read("../src/lib/sellfox/mcp-tool-registry.ts").includes("ProductRecord"));
  assert.ok(!read("../src/lib/amazon-sync/mcp-datasets.ts").includes("ProductRecord"));
  assert.ok(!amazonLocalRawTables.some(table => !table.startsWith("Amazon")));
});

test("决策 5：MCP 查询只返回数据集显式登记的安全字段", () => {
  assert.match(sellfoxMcp, /args\.fields === "all" \? \(dataset\.allColumns \?\? dataset\.columns\) : dataset\.columns/);
  assert.doesNotMatch(sellfoxMcp, /: "t\.\*"/);
  assert.match(amazonRead, /amazonLocalVisibleColumns\(columns\)/, "Amazon 侧必须按真实物理列整行投影");
  assert.match(amazonRead, /SET TRANSACTION READ ONLY/);
});
