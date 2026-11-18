import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getModuleIdForPath, permissionModules, type PermissionAction } from "@/lib/accounts/permissions";
import { normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";
import { sellfoxPlanGroups } from "@/lib/sellfox/data-plan";

/**
 * 账号权限中心唯一并集计算入口。
 * 最终权限 = 角色授权 ∪ 成员补充授权；无 deny；owner/database_admin 全量旁路。
 * 迁移期双读：优先读 ResourceGrant，同时读旧表兜底，保持旧客户端行为不变。
 * 任何金额字段以字符串表达；缺失数据保留 null / 空集合，不补零、不 mock。
 */

export type AccessDbClient = PrismaClient | Prisma.TransactionClient;
export type AccessResourceSource = "ROLE" | "MEMBER" | "BOTH" | "ADMIN" | "MIGRATED";

export type EffectiveAccessInput = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  roleId?: string;
  db?: AccessDbClient;
};

export type AmazonEffectiveScope = {
  sellerAccountId: string;
  marketplaces: string[];
  actions: PermissionAction[];
  mcp: boolean;
};

export type EffectiveAccess = {
  roleId: string;
  isAdmin: boolean;
  modules: Record<string, PermissionAction[]>;
  amazon: {
    allSellers: boolean;
    sellers: AmazonEffectiveScope[];
  };
  sellfox: {
    allStores: boolean;
    stores: string[];
    domains: Record<string, PermissionAction[]>;
  };
  mcp: Array<{ provider: "amazon" | "sellfox"; tools: string[] }>;
  approvals: Array<{ type: string; min: string | null; max: string | null; actions: string[] }>;
  points: { quota: string | null; maxRequestAmount: string | null; maxRequestsPerPeriod: number | null };
  sources: Record<string, AccessResourceSource>;
};

const ADMIN_ROLES = new Set(["owner", "database_admin"]);

function toActions(values: string[]): PermissionAction[] {
  const allowed = new Set<PermissionAction>(["view", "create", "edit", "approve", "export"]);
  return [...new Set(values.filter((value): value is PermissionAction => allowed.has(value as PermissionAction)))];
}

function mergeActions(...groups: string[][]): PermissionAction[] {
  return toActions(groups.flat());
}

function mergeScopes(...groups: AmazonEffectiveScope[]): AmazonEffectiveScope[] {
  const bySeller = new Map<string, AmazonEffectiveScope>();
  for (const scope of groups) {
    const current = bySeller.get(scope.sellerAccountId);
    if (!current) {
      bySeller.set(scope.sellerAccountId, {
        sellerAccountId: scope.sellerAccountId,
        marketplaces: [...new Set(scope.marketplaces)].sort(),
        actions: mergeActions(scope.actions),
        mcp: scope.mcp,
      });
      continue;
    }
    current.marketplaces = [...new Set([...current.marketplaces, ...scope.marketplaces])].sort();
    current.actions = mergeActions(current.actions, scope.actions);
    current.mcp = current.mcp || scope.mcp;
  }
  return [...bySeller.values()].sort((a, b) => a.sellerAccountId.localeCompare(b.sellerAccountId));
}

function stringField(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function resourceKey(type: string, id: string) {
  return `${type}:${id}`;
}

function markSource(sources: Record<string, AccessResourceSource>, key: string, source: AccessResourceSource) {
  const existing = sources[key];
  if (source === "MIGRATED") {
    if (!existing) sources[key] = "MIGRATED";
    return;
  }
  if (!existing || existing === "MIGRATED") {
    sources[key] = source;
  } else if (existing !== source) {
    sources[key] = "BOTH";
  }
}

export async function getEffectiveAccess(input: EffectiveAccessInput): Promise<EffectiveAccess> {
  const db = input.db ?? prisma;
  const workspaceId = input.workspaceId || "default";

  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
    select: { role: true, user: { select: { status: true } } },
  });
  const roleId = input.roleId ?? member?.role ?? "";
  const isAdmin = ADMIN_ROLES.has(roleId);

  // 读取统一授权表（新）：角色授权 + 成员补充授权。
  const grantWhere = {
    organizationId: input.organizationId,
    enabled: true,
    OR: [
      { workspaceId, subjectType: "ROLE", subjectId: roleId },
      { workspaceId, subjectType: "MEMBER", subjectId: input.userId },
      // 组织级资源（MODULE/APPROVAL/POINTS 等）用 default 工作区承载，对所有工作区生效。
      { workspaceId: "default", subjectType: "ROLE", subjectId: roleId },
      { workspaceId: "default", subjectType: "MEMBER", subjectId: input.userId },
    ],
  };
  const grants = await db.resourceGrant.findMany({ where: grantWhere });

  const modules: Record<string, PermissionAction[]> = {};
  const amazonScopes: AmazonEffectiveScope[] = [];
  const sellfoxStores = new Set<string>();
  const sellfoxDomains: Record<string, PermissionAction[]> = {};
  const mcpTools: Record<"amazon" | "sellfox", Set<string>> = { amazon: new Set(), sellfox: new Set() };
  const approvals: EffectiveAccess["approvals"] = [];
  let points: EffectiveAccess["points"] = { quota: null, maxRequestAmount: null, maxRequestsPerPeriod: null };
  const sources: Record<string, AccessResourceSource> = {};

  for (const grant of grants) {
    const subjectSource: AccessResourceSource = grant.subjectType === "ROLE" ? "ROLE" : "MEMBER";
    const scope = (grant.scopeJson ?? {}) as Record<string, unknown>;
    const actions = toActions(grant.actions);
    const list = Array.isArray(scope.marketplaceIds) ? scope.marketplaceIds.filter((m): m is string => typeof m === "string") : [];

    switch (grant.resourceType) {
      case "MODULE": {
        const key = resourceKey("MODULE", grant.resourceId);
        modules[grant.resourceId] = mergeActions(modules[grant.resourceId] ?? [], actions);
        markSource(sources, key, grant.source === "MIGRATED" ? "MIGRATED" : subjectSource);
        break;
      }
      case "AMAZON_SELLER": {
        amazonScopes.push({
          sellerAccountId: grant.resourceId,
          marketplaces: list,
          actions,
          mcp: actions.includes("mcp" as PermissionAction),
        });
        markSource(sources, resourceKey("AMAZON_SELLER", grant.resourceId), grant.source === "MIGRATED" ? "MIGRATED" : subjectSource);
        break;
      }
      case "SELLFOX_STORE": {
        sellfoxStores.add(grant.resourceId);
        markSource(sources, resourceKey("SELLFOX_STORE", grant.resourceId), grant.source === "MIGRATED" ? "MIGRATED" : subjectSource);
        break;
      }
      case "SELLFOX_DOMAIN": {
        sellfoxDomains[grant.resourceId] = mergeActions(sellfoxDomains[grant.resourceId] ?? [], actions);
        markSource(sources, resourceKey("SELLFOX_DOMAIN", grant.resourceId), grant.source === "MIGRATED" ? "MIGRATED" : subjectSource);
        break;
      }
      case "MCP_TOOL": {
        const provider = scope.provider === "sellfox" ? "sellfox" : "amazon";
        mcpTools[provider].add(grant.resourceId);
        markSource(sources, resourceKey("MCP_TOOL", grant.resourceId), subjectSource);
        break;
      }
      case "APPROVAL": {
        approvals.push({
          type: grant.resourceId,
          min: stringField(scope.amountMin),
          max: stringField(scope.amountMax),
          actions: grant.actions,
        });
        markSource(sources, resourceKey("APPROVAL", grant.resourceId), subjectSource);
        break;
      }
      case "POINTS": {
        points = {
          quota: stringField(scope.quota),
          maxRequestAmount: stringField(scope.maxRequestAmount),
          maxRequestsPerPeriod: typeof scope.maxRequestsPerPeriod === "number" ? scope.maxRequestsPerPeriod : null,
        };
        break;
      }
      default:
        break;
    }
  }

  // 旧表兜底（迁移期双读）：角色模块权限。
  const roleRows = await db.organizationRosterRole.findMany({
    where: { organizationId: input.organizationId, id: roleId },
    select: { id: true, permissions: true },
  });
  for (const row of roleRows) {
    const perms = normalizeRolePermissions(row.permissions);
    for (const [moduleId, actions] of Object.entries(perms)) {
      const key = resourceKey("MODULE", moduleId);
      if (!Object.prototype.hasOwnProperty.call(modules, moduleId)) {
        modules[moduleId] = mergeActions(actions);
        markSource(sources, key, "MIGRATED");
      } else {
        modules[moduleId] = mergeActions(modules[moduleId], actions);
        markSource(sources, key, "ROLE");
      }
    }
  }

  // 旧表兜底：Amazon 成员授权 + 角色授权（view/export 也在此并集）。
  const [memberGrants, roleGrants] = await Promise.all([
    db.amazonDataAccessGrant.findMany({
      where: { organizationId: input.organizationId, workspaceId, userId: input.userId, enabled: true },
      select: { sellerAccountId: true, marketplaceIds: true, actions: true, mcpEnabled: true },
    }),
    db.amazonRoleDataAccessGrant.findMany({
      where: { organizationId: input.organizationId, workspaceId, roleId, enabled: true },
      select: { sellerAccountId: true, marketplaceIds: true, actions: true, mcpEnabled: true },
    }),
  ]);
  for (const g of memberGrants) {
    amazonScopes.push({ sellerAccountId: g.sellerAccountId, marketplaces: g.marketplaceIds, actions: toActions(g.actions), mcp: g.mcpEnabled });
    markSource(sources, resourceKey("AMAZON_SELLER", g.sellerAccountId), "MIGRATED");
  }
  for (const g of roleGrants) {
    amazonScopes.push({ sellerAccountId: g.sellerAccountId, marketplaces: g.marketplaceIds, actions: toActions(g.actions), mcp: g.mcpEnabled });
    markSource(sources, resourceKey("AMAZON_SELLER", g.sellerAccountId), "MIGRATED");
  }

  // 旧表兜底：赛狐凭据店铺范围（仅作店铺集合兜底，不等同于细粒度授权）。
  const sellfoxCred = await db.sellfoxMcpCredential.findFirst({
    where: { organizationId: input.organizationId, userId: input.userId, status: "ACTIVE" },
    select: { storeIds: true },
    orderBy: { createdAt: "desc" },
  });
  if (sellfoxCred?.storeIds?.length) {
    for (const storeId of sellfoxCred.storeIds) sellfoxStores.add(storeId);
  }

  // 管理员旁路：标记全量，但不伪造具体店铺/域数据（由调用方按 allSellers/allStores 放行）。
  if (isAdmin) {
    for (const permModule of permissionModules) markSource(sources, resourceKey("MODULE", permModule.id), "ADMIN");
  }

  return {
    roleId,
    isAdmin,
    modules,
    amazon: { allSellers: isAdmin, sellers: mergeScopes(...amazonScopes) },
    sellfox: { allStores: isAdmin, stores: [...sellfoxStores].sort(), domains: sellfoxDomains },
    mcp: [
      { provider: "amazon", tools: [...mcpTools.amazon].sort() },
      { provider: "sellfox", tools: [...mcpTools.sellfox].sort() },
    ],
    approvals,
    points,
    sources,
  };
}

/**
 * 按金额区间匹配审批层级（单人审批 + 金额分级）。
 * 金额用定点小数字符串比较（转 BigInt），避免浮点误差；null 边界表示无限制。
 * 返回所有命中的层级（金额可能落在多个区间，取调用方需要的动作）。
 */
export function matchApprovalTier(
  approvals: EffectiveAccess["approvals"],
  type: string,
  amount: string,
): EffectiveAccess["approvals"] {
  const parse = (value: string): bigint => {
    const [whole, frac = ""] = value.split(".");
    const padded = frac.padEnd(6, "0").slice(0, 6);
    return BigInt(whole || "0") * 1_000_000n + BigInt(padded || "0");
  };
  let amountValue: bigint;
  try {
    amountValue = parse(amount);
  } catch {
    return [];
  }
  return approvals.filter((entry) => {
    if (entry.type !== type) return false;
    const minOk = entry.min === null || amountValue >= parse(entry.min);
    const maxOk = entry.max === null || amountValue < parse(entry.max);
    return minOk && maxOk;
  });
}

/** 供 UI 展示的赛狐域清单（70 域，按业务板块分组）。 */
export function listSellfoxDomains() {
  return sellfoxPlanGroups.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.items.map((item) => ({ id: item.id, label: item.label, table: item.table ?? null, status: item.status })),
  }));
}

/**
 * 轻量 MCP 工具授权集合：返回该主体被明确授权的工具名（角色∪成员）。
 * 返回 null 表示"无明确 MCP_TOOL 授权，回退凭据自身 tools"（双读期兼容）。
 */
export async function getMcpToolGrantScope(input: {
  organizationId: string;
  workspaceId: string;
  userId: string;
  provider: "amazon" | "sellfox";
  roleId?: string;
  db?: AccessDbClient;
}): Promise<string[] | null> {
  const db = input.db ?? prisma;
  const roleId = input.roleId ?? (await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
    select: { role: true },
  }))?.role ?? "";

  const grants = await db.resourceGrant.findMany({
    where: {
      organizationId: input.organizationId,
      resourceType: "MCP_TOOL",
      enabled: true,
      OR: [
        { workspaceId: input.workspaceId, subjectType: "ROLE", subjectId: roleId },
        { workspaceId: input.workspaceId, subjectType: "MEMBER", subjectId: input.userId },
        { workspaceId: "default", subjectType: "ROLE", subjectId: roleId },
        { workspaceId: "default", subjectType: "MEMBER", subjectId: input.userId },
      ],
    },
    select: { resourceId: true, scopeJson: true },
  });
  const matching = grants.filter((grant) => {
    const provider = (grant.scopeJson as { provider?: string } | null)?.provider;
    return !provider || provider === input.provider;
  });
  if (matching.length === 0) return null;
  return [...new Set(matching.map((grant) => grant.resourceId))].sort();
}

/**
 * 轻量赛狐店铺范围：供数据读取层在查询前注入 storeId 过滤。
 * 返回 null 表示"无明确授权数据，回退现有行为"；返回数组（可能为空）表示强制隔离。
 * 管理员返回 null（全量旁路，由调用方 isAdmin 判断）。
 */
export async function getSellfoxStoreScope(input: {
  organizationId: string;
  workspaceId: string;
  userId: string;
  roleId?: string;
  db?: AccessDbClient;
}): Promise<string[] | null> {
  const db = input.db ?? prisma;
  const workspaceId = input.workspaceId || "default";
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
    select: { role: true },
  });
  const roleId = input.roleId ?? member?.role ?? "";
  if (ADMIN_ROLES.has(roleId)) return null;

  const grants = await db.resourceGrant.findMany({
    where: {
      organizationId: input.organizationId,
      resourceType: "SELLFOX_STORE",
      enabled: true,
      OR: [
        { workspaceId, subjectType: "ROLE", subjectId: roleId },
        { workspaceId, subjectType: "MEMBER", subjectId: input.userId },
        { workspaceId: "default", subjectType: "ROLE", subjectId: roleId },
        { workspaceId: "default", subjectType: "MEMBER", subjectId: input.userId },
      ],
    },
    select: { resourceId: true },
  });
  // 双读期：存在明确的 SELLFOX_STORE 授权才强制隔离；否则回退旧行为（不收紧）。
  if (grants.length === 0) return null;
  return [...new Set(grants.map((grant) => grant.resourceId))].sort();
}

/** 判断某成员是否可访问某模块（并集口径，供 service 复用）。 */
export function effectiveModuleActions(access: EffectiveAccess, moduleId: string): PermissionAction[] {
  if (access.isAdmin) return ["view", "create", "edit", "approve", "export"];
  return access.modules[moduleId] ?? [];
}

/** 由 href 反查 moduleId，保持与权限模型一致。 */
export function moduleIdForHref(href: string): string | null {
  return getModuleIdForPath(href.split("?")[0]);
}
