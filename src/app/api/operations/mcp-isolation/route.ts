import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { prisma } from "@/lib/db/prisma";
import { amazonMcpToolCatalog, listMcpCredentials, listMcpScopeOptions } from "@/lib/amazon-sync/mcp";
import { mcpIsolationMatrix, McpIsolationError, mcpProviderPolicies } from "@/lib/mcp/isolation";
import { listSellfoxMcpCredentials, manageSellfoxMcpCredential, probeSellfoxReadOnly, sellfoxMcpCatalog } from "@/lib/sellfox/mcp";
import { sellfoxDatasetKeys, sellfoxDatasets, sellfoxMcpToolNames } from "@/lib/sellfox/mcp-tool-registry";

export const runtime = "nodejs";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

function errorResponse(error: unknown) {
  if (error instanceof McpIsolationError) return json({ error: error.message, code: error.code, provider: error.provider }, error.status);
  return json({ error: "MCP 隔离配置操作失败。" }, 500);
}

const activeCredentials = (rows: Array<{ status: string; expiresAt: Date }>) =>
  rows.filter(row => row.status === "ACTIVE" && row.expiresAt > new Date());

const lastUsedAt = (rows: Array<{ lastUsedAt: Date | null }>) =>
  rows.reduce<Date | null>((latest, row) => (row.lastUsedAt && (!latest || row.lastUsedAt > latest) ? row.lastUsedAt : latest), null);

/**
 * 数据库角色层的真实越权检查。只读 information_schema / has_table_privilege，
 * 不执行任何 DDL。环境变量是否配置只代表「连接已配」，不等于「角色层已隔离」。
 */
type DbRoleAudit = {
  available: boolean;
  roles: Array<{ role: string; amazonTables: number; sellfoxTables: number }>;
  violations: string[];
  note: string;
};
async function inspectDatabaseRoles(): Promise<DbRoleAudit> {
  try {
    const rows = await prisma.$queryRaw<Array<{ role: string; amazon: number; sellfox: number }>>`
      SELECT r.rolname::text AS role,
             count(*) FILTER (WHERE t.table_name LIKE 'Amazon%'
               AND has_table_privilege(r.rolname, quote_ident(t.table_name), 'SELECT'))::int AS amazon,
             count(*) FILTER (WHERE t.table_name LIKE 'Sellfox%'
               AND has_table_privilege(r.rolname, quote_ident(t.table_name), 'SELECT'))::int AS sellfox
      FROM pg_roles r
      CROSS JOIN information_schema.tables t
      WHERE r.rolname IN ('sellfox_mcp_ro', 'amazon_mcp_ro')
        AND t.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
        AND (t.table_name LIKE 'Amazon%' OR t.table_name LIKE 'Sellfox%')
      GROUP BY r.rolname`;
    const roles = rows.map(row => ({ role: row.role, amazonTables: Number(row.amazon), sellfoxTables: Number(row.sellfox) }));
    const sellfox = roles.find(row => row.role === "sellfox_mcp_ro");
    const amazon = roles.find(row => row.role === "amazon_mcp_ro");
    const violations: string[] = [];
    if (sellfox && sellfox.amazonTables > 0) violations.push(`sellfox_mcp_ro 仍可读 ${sellfox.amazonTables} 张 Amazon* 表`);
    if (!amazon) violations.push("缺少 amazon_mcp_ro 独立只读角色");
    else if (amazon.sellfoxTables > 0) violations.push(`amazon_mcp_ro 仍可读 ${amazon.sellfoxTables} 张 Sellfox* 表`);
    if (!sellfox) violations.push("缺少 sellfox_mcp_ro 只读角色");
    return { available: true, roles, violations, note: "依据 information_schema 与 has_table_privilege 实测，不含环境变量推断。" };
  } catch (error) {
    return { available: false, roles: [], violations: [], note: `角色权限查询不可用，状态未知，不宣称已隔离：${error instanceof Error ? error.message.slice(0, 120) : "unknown"}` };
  }
}

/** Audit rows are user-facing; keep only the fields the settings page renders. */
function auditLabel(action: string) {
  const tail = action.replace(/^(amazon|sellfox)\.mcp\./, "");
  if (tail.startsWith("isolation.denied")) return "跨服务凭证被拒绝";
  if (tail.startsWith("credential.create")) return "创建凭证";
  if (tail.startsWith("credential.rotate")) return "轮换密钥";
  if (tail.startsWith("credential.disable")) return "禁用凭证";
  if (tail.startsWith("credential.revoke")) return "撤销凭证";
  if (tail.startsWith("authentication.denied")) return "认证失败";
  if (tail.startsWith("tool.succeeded")) return "工具调用成功";
  if (tail.startsWith("tool.denied")) return "工具调用被拒绝";
  if (tail.startsWith("protocol.")) return `协议 ${tail.slice("protocol.".length)}`;
  return tail || action;
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    const [sellfoxCredentials, amazonCredentials, stores, scopeOptions, auditLogs, dbRoleAudit] = await Promise.all([
      listSellfoxMcpCredentials(scope, permission.user.id),
      listMcpCredentials(scope, permission.user.id).catch(() => []),
      prisma.sellfoxStore.findMany({ where: scope, select: { id: true, externalId: true, name: true, marketplace: true, country: true }, orderBy: { name: "asc" }, take: 500 }),
      listMcpScopeOptions(scope, permission.user.id).catch(() => []),
      prisma.auditLog.findMany({
        where: { organizationId: scope.organizationId, OR: [{ action: { startsWith: "amazon.mcp." } }, { action: { startsWith: "sellfox.mcp." } }] },
        select: { id: true, action: true, createdAt: true, entityType: true },
        orderBy: { createdAt: "desc" },
        take: 12,
      }).catch(() => []),
      inspectDatabaseRoles(),
    ]);

    const sellfoxReadonly = Boolean(process.env.MCP_PG_READONLY_URL?.trim());
    const amazonReadonly = Boolean(process.env.AMAZON_MCP_PG_READONLY_URL?.trim());
    const sharedTokenEnabled = Boolean(process.env.MCP_HTTP_TOKEN?.trim()) && process.env.MCP_DISABLE_SHARED_TOKEN !== "true";
    const sellfoxActive = activeCredentials(sellfoxCredentials);
    const amazonActive = activeCredentials(amazonCredentials);
    const sellfoxRole = dbRoleAudit.roles.find(row => row.role === "sellfox_mcp_ro");
    const amazonRole = dbRoleAudit.roles.find(row => row.role === "amazon_mcp_ro");
    const dbIsolated = dbRoleAudit.available && dbRoleAudit.violations.length === 0;

    const health = [
      { key: "endpoints", label: "端点各自鉴权", state: "ok", detail: `${mcpProviderPolicies.amazon.audiencePath} 与 ${mcpProviderPolicies.sellfox.audiencePath} 独立解析令牌，旧 /api/mcp 只保留赛狐别名` },
      { key: "prefix", label: "令牌前缀隔离", state: "ok", detail: `${mcpProviderPolicies.amazon.tokenPrefix} 只能换到 Amazon 凭证，${mcpProviderPolicies.sellfox.tokenPrefix} 只能换到赛狐凭证` },
      { key: "cross", label: "跨服务请求", state: "ok", detail: "在查询数据库前拒绝，并写入 isolation.denied 审计" },
      { key: "catalog", label: "工具与数据集封闭清单", state: "ok", detail: `Amazon 仅 amazon.*，赛狐仅 sellfox.* 与 ${sellfoxDatasetKeys.length} 个数据集` },
      { key: "fence", label: "店铺 / 站点围栏", state: "ok", detail: "凭证范围之外的店铺、账号、站点一律 403 STORE_NOT_ALLOWED" },
      { key: "sellfox-ro", label: "赛狐只读连接", state: sellfoxReadonly ? "ok" : "warn", detail: sellfoxReadonly
          ? `MCP_PG_READONLY_URL 已配置（sellfox_mcp_ro）；${dbRoleAudit.available ? `实测该角色可读 Amazon* 表 ${sellfoxRole?.amazonTables ?? 0} 张（应为 0）` : "角色权限实测不可用，跨池归属未核实"}`
          : "未配置 MCP_PG_READONLY_URL，赛狐工具调用会直接失败（不会回退到可写连接）" },
      { key: "amazon-ro", label: "Amazon 只读连接", state: amazonReadonly ? "ok" : "warn", detail: amazonReadonly
          ? `AMAZON_MCP_PG_READONLY_URL 已配置，原始行读取走独立连接 + 只读事务；${dbRoleAudit.available ? (amazonRole ? `实测 amazon_mcp_ro 可读 Sellfox* 表 ${amazonRole.sellfoxTables} 张（应为 0）` : "库中尚无 amazon_mcp_ro 角色") : "角色权限实测不可用"}`
          : "未配置 AMAZON_MCP_PG_READONLY_URL，读路径走主连接 + 只读事务；应用层只读仍强制生效" },
      { key: "db-cross-pool", label: "数据库角色层双池隔离", state: dbIsolated ? "ok" : "warn", detail: dbIsolated
          ? "实测 0 越权：sellfox_mcp_ro 对 Amazon* 无 SELECT，amazon_mcp_ro 对 Sellfox* 无 SELECT；可用 node scripts/mcp-isolation/audit-roles.mjs 复核"
          : dbRoleAudit.available
            ? `实测未收口：${dbRoleAudit.violations.join("；")}。应用层 Amazon*/Sellfox* 前缀封闭清单仍生效，不是数据泄露；执行 scripts/mcp-isolation/grant-roles.sql（DBA 用强密码创建角色）并配 AMAZON_MCP_PG_READONLY_URL 后复跑 audit-roles.mjs`
            : `状态未知，不能按环境变量推断为已隔离：${dbRoleAudit.note}` },
      { key: "shared-token", label: "兼容共享令牌", state: sharedTokenEnabled ? "warn" : "ok", detail: sharedTokenEnabled ? "MCP_HTTP_TOKEN 仍启用，可在赛狐端点只读访问单组织全部店铺" : "已关闭共享令牌，只接受个人凭证" },
      { key: "credentials", label: "可用凭证", state: sellfoxActive.length + amazonActive.length ? "ok" : "warn", detail: `Amazon ${amazonActive.length} 个 · 赛狐 ${sellfoxActive.length} 个可用（已排除过期与停用）` },
    ] as const;

    return json({
      matrix: mcpIsolationMatrix(process.env as Record<string, string | undefined>),
      health,
      dbRoleAudit,
      audit: auditLogs.map(log => ({
        id: log.id,
        provider: log.action.startsWith("amazon.mcp.") ? "amazon" : "sellfox",
        action: log.action,
        label: auditLabel(log.action),
        outcome: log.action.includes("denied") ? "拒绝" : log.action.includes("credential") || log.action.includes("authentication") ? "变更" : "调用",
        createdAt: log.createdAt,
      })),
      endpoints: {
        amazon: { path: mcpProviderPolicies.amazon.audiencePath, tokenPrefix: mcpProviderPolicies.amazon.tokenPrefix, credentialCount: amazonCredentials.length, isolation: "账号+站点显式选择；跨账号查询直接拒绝" },
        sellfox: { path: mcpProviderPolicies.sellfox.audiencePath, tokenPrefix: mcpProviderPolicies.sellfox.tokenPrefix, credentialCount: sellfoxCredentials.length, legacyPath: "/api/mcp", isolation: "凭证店铺围栏 + 数据集封闭清单 + 只读角色" },
      },
      amazon: {
        credentials: amazonCredentials.map(credential => ({
          id: credential.id, name: credential.name, status: credential.status, revision: credential.revision,
          tokenPrefix: credential.tokenPrefix, tools: credential.tools, scopes: credential.scopes,
          expiresAt: credential.expiresAt, lastUsedAt: credential.lastUsedAt,
        })),
        scopeOptions: scopeOptions.map(option => ({ sellerAccountId: option.sellerAccountId, marketplaceId: option.marketplaceId, displayName: option.displayName })),
        tools: amazonMcpToolCatalog.map(tool => ({ name: tool.name, description: tool.description, operationMode: tool.operationMode, version: tool.version })),
        readonlyConfigured: amazonReadonly,
        activeCount: amazonActive.length,
        lastUsedAt: lastUsedAt(amazonCredentials),
      },
      sellfox: {
        credentials: sellfoxCredentials.map(credential => ({
          id: credential.id, name: credential.name, status: credential.status, revision: credential.revision,
          tokenPrefix: credential.tokenPrefix, tools: credential.tools, storeIds: credential.storeIds,
          expiresAt: credential.expiresAt, lastUsedAt: credential.lastUsedAt,
        })),
        stores,
        tools: sellfoxMcpCatalog(),
        datasets: sellfoxDatasetKeys.map(key => ({ key, label: sellfoxDatasets[key].label, description: sellfoxDatasets[key].description, table: sellfoxDatasets[key].table })),
        catalogSize: sellfoxMcpToolNames.length,
        readonlyRoleConfigured: sellfoxReadonly,
        sharedTokenEnabled,
        activeCount: sellfoxActive.length,
        lastUsedAt: lastUsedAt(sellfoxCredentials),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 16_000) return json({ error: "请求过大。" }, 413);
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const permission = await requireApiPermission("sellfox", action === "probe" ? "view" : action === "create" || action === "rotate" ? "create" : "edit", request);
    if (!permission.ok) return permission.response;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    if (action === "probe") {
      const provider = body.provider === "amazon" ? "amazon" : "sellfox";
      if (provider === "sellfox") return json({ provider, ...(await probeSellfoxReadOnly()) });
      const startedAt = Date.now();
      try {
        await prisma.$queryRaw`SELECT 1 AS ok`;
        return json({ provider, ok: true, latencyMs: Date.now() - startedAt, detail: `主连接可用（${Date.now() - startedAt} ms）；Amazon 读路径使用主连接，应用层只读` });
      } catch {
        return json({ provider, ok: false, latencyMs: Date.now() - startedAt, detail: "数据库连接不可用。" });
      }
    }
    return json(await manageSellfoxMcpCredential(scope, permission.user.id, body));
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "JSON 解析失败。" }, 400);
    return errorResponse(error);
  }
}
