import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { prisma } from "@/lib/db/prisma";
import { amazonMcpToolCatalog, listMcpCredentials, listMcpScopeOptions } from "@/lib/amazon-sync/mcp";
import { mcpIsolationMatrix, McpIsolationError, mcpProviderPolicies } from "@/lib/mcp/isolation";
import { inspectDatabaseRoles, probeDatabaseRole } from "@/lib/mcp/database-audit.mjs";
import { listSellfoxMcpCredentials, manageSellfoxMcpCredential, sellfoxMcpCatalog } from "@/lib/sellfox/mcp";
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
      { key: "sellfox-ro", label: "赛狐只读连接", state: sellfoxRole && !sellfoxRole.unavailable && !sellfoxRole.violations.length ? "ok" : "warn",
        detail: !sellfoxRole || sellfoxRole.unavailable ? "sellfox_mcp_ro 审计不可用，隔离状态未知" : sellfoxRole.violations.length ? sellfoxRole.violations.join("；") : "sellfox_mcp_ro 独立登录及完整有效权限审计通过" },
      { key: "amazon-ro", label: "Amazon 只读连接", state: amazonRole && !amazonRole.unavailable && !amazonRole.violations.length ? "ok" : "warn",
        detail: !amazonRole || amazonRole.unavailable ? "amazon_mcp_ro 审计不可用，隔离状态未知" : amazonRole.violations.length ? amazonRole.violations.join("；") : "amazon_mcp_ro 独立登录及完整有效权限审计通过" },
      { key: "db-cross-pool", label: "数据库角色层双池隔离", state: dbIsolated ? "ok" : "warn", detail: dbIsolated
          ? "两实际只读登录有效权限审计通过：仅本提供方表 SELECT，无跨池、写入、转授权或角色切换路径；与 audit-roles.mjs 使用同一规则"
          : `隔离未通过或状态未知：${dbRoleAudit.violations.join("；")}。由 DBA 按 docs/mcp-isolation-amazon-sellfox.md 逐项处理后复核；仓库整改不代表数据库授权已实施` },
      { key: "credential-source", label: "凭证单一来源", state: "ok", detail: "仅接受数据库中明确授权的个人凭证；不接受环境共享令牌" },
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
    const body = await request.clone().json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const permission = await requireApiPermission("sellfox", action === "probe" ? "view" : action === "create" || action === "rotate" ? "create" : "edit", request);
    if (!permission.ok) return permission.response;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
    if (action === "probe") {
      const provider = body.provider === "amazon" ? "amazon" : "sellfox";
      return json(await probeDatabaseRole(provider));
    }
    return json(await manageSellfoxMcpCredential(scope, permission.user.id, body));
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "JSON 解析失败。" }, 400);
    return errorResponse(error);
  }
}
