import { Prisma, type OrganizationRole } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { permissionModules, permissionActions } from "@/lib/accounts/permissions";
import { sellfoxPlanGroups } from "@/lib/sellfox/data-plan";

/**
 * 授权中心服务端统一读写层。
 * 所有对 ResourceGrant 的写入都经过这里，保证 revision 乐观锁 + 审计 + 主体隔离一致。
 * 金额字段一律以字符串表达；缺失数据保留 null，不补零、不 mock。
 */

export type SubjectType = "ROLE" | "MEMBER";

export type GrantChange = {
  resourceType: string;
  resourceId: string;
  /** 空数组表示删除该条授权。 */
  actions: string[];
  /** 站点列表/金额区间/provider 等可变维度；金额用字符串。 */
  scopeJson?: Record<string, unknown> | null;
};

export type GrantRow = {
  id: string;
  resourceType: string;
  resourceId: string;
  actions: string[];
  scopeJson: Record<string, unknown> | null;
  enabled: boolean;
  source: string;
  revision: number;
};

const ACTION_SET = new Set<string>(permissionActions.map((action) => action.id));
const MCP_ACTIONS = new Set(["call", "read", "write", "mcp"]);

function normalizeActions(resourceType: string, actions: unknown): string[] {
  if (!Array.isArray(actions)) return [];
  const pool = resourceType === "MCP_TOOL" ? MCP_ACTIONS : ACTION_SET;
  return [...new Set(actions.filter((a): a is string => typeof a === "string" && pool.has(a)))].sort();
}

function toScopeJson(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function buildRevision(grants: Array<{ id: string; updatedAt: Date }>): string {
  const latest = grants.reduce((max, row) => Math.max(max, row.updatedAt.getTime()), 0);
  return `${grants.length}:${latest}:${grants.map((row) => row.id).sort().join(",")}`;
}

export type SubjectGrantsResult = {
  subjectType: SubjectType;
  subjectId: string;
  grants: GrantRow[];
  revision: string;
};

/** 读取某主体的全部授权（含来源与整体 revision）。 */
export async function getSubjectGrants(input: {
  organizationId: string;
  workspaceId: string;
  subjectType: SubjectType;
  subjectId: string;
}): Promise<SubjectGrantsResult> {
  const workspaceId = input.workspaceId || "default";
  const rows = await prisma.resourceGrant.findMany({
    where: {
      organizationId: input.organizationId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      OR: [{ workspaceId }, { workspaceId: "default" }],
    },
    orderBy: [{ resourceType: "asc" }, { resourceId: "asc" }],
  });
  return {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    grants: rows.map((row) => ({
      id: row.id,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      actions: row.actions,
      scopeJson: toScopeJson(row.scopeJson),
      enabled: row.enabled,
      source: row.source,
      revision: row.revision,
    })),
    revision: buildRevision(rows),
  };
}

export type SaveGrantsResult =
  | { ok: true; revision: string; applied: number }
  | { ok: false; reason: "conflict"; revision: string; currentRevision: string };

/**
 * 批量保存某主体授权。revision 乐观锁：不匹配返回 conflict（HTTP 409），不覆盖他人修改。
 * 变更以 (resourceType, resourceId) 为单位，actions 为空即删除。
 */
export async function saveSubjectGrants(input: {
  organizationId: string;
  workspaceId: string;
  subjectType: SubjectType;
  subjectId: string;
  changes: GrantChange[];
  expectedRevision: string;
  actor: { id: string; role: string };
}): Promise<SaveGrantsResult> {
  const workspaceId = input.workspaceId || "default";
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.resourceGrant.findMany({
      where: {
        organizationId: input.organizationId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        OR: [{ workspaceId }, { workspaceId: "default" }],
      },
    });
    const currentRevision = buildRevision(current);
    if (currentRevision !== input.expectedRevision) {
      return { conflict: true as const, currentRevision };
    }

    const byKey = new Map(current.map((row) => [`${row.resourceType}:${row.resourceId}`, row]));
    let applied = 0;

    for (const change of input.changes) {
      const actions = normalizeActions(change.resourceType, change.actions);
      const key = `${change.resourceType}:${change.resourceId}`;
      const existing = byKey.get(key);
      const scopeJson = toScopeJson(change.scopeJson);

      if (actions.length === 0) {
        if (existing) {
          await tx.resourceGrant.delete({ where: { id: existing.id } });
          byKey.delete(key);
          applied += 1;
        }
        continue;
      }

      if (existing) {
        await tx.resourceGrant.update({
          where: { id: existing.id },
          data: {
            actions,
            ...(scopeJson !== null ? { scopeJson: scopeJson as Prisma.InputJsonValue } : {}),
            enabled: true,
            source: "MANUAL",
            revision: { increment: 1 },
            updatedBy: input.actor.id,
          },
        });
        applied += 1;
      } else {
        const created = await tx.resourceGrant.create({
          data: {
            organizationId: input.organizationId,
            workspaceId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            resourceType: change.resourceType,
            resourceId: change.resourceId,
            actions,
            ...(scopeJson !== null ? { scopeJson: scopeJson as Prisma.InputJsonValue } : {}),
            source: "MANUAL",
            revision: 1,
            createdBy: input.actor.id,
            updatedBy: input.actor.id,
          },
        });
        byKey.set(key, created);
        applied += 1;
      }
    }

    const after = await tx.resourceGrant.findMany({
      where: {
        organizationId: input.organizationId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        OR: [{ workspaceId }, { workspaceId: "default" }],
      },
    });
    return { conflict: false as const, currentRevision, revision: buildRevision(after), applied };
  });

  if (result.conflict) {
    return { ok: false, reason: "conflict", revision: input.expectedRevision, currentRevision: result.currentRevision };
  }

  if (result.applied > 0) {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.actor.id,
        action: "access.grant.changed",
        entityType: "ResourceGrant",
        entityId: `${input.subjectType}:${input.subjectId}`,
        metadata: JSON.parse(JSON.stringify({
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          workspaceId,
          changes: input.changes,
          applied: result.applied,
          revision: result.revision,
        })) as Prisma.InputJsonValue,
      },
    });
  }

  return { ok: true, revision: result.revision, applied: result.applied };
}

/** 某角色绑定的成员数（用于"影响人数"评估）。 */
export async function countRoleMembers(organizationId: string, roleId: string): Promise<number> {
  return prisma.organizationMember.count({ where: { organizationId, role: roleId as OrganizationRole } });
}

/** 保存前 diff 预览：逐条列出资源·动作·前→后，并评估影响人数。 */
export async function previewAccessChanges(input: {
  organizationId: string;
  workspaceId: string;
  subjectType: SubjectType;
  subjectId: string;
  changes: GrantChange[];
}): Promise<{
  diff: Array<{ resourceType: string; resourceId: string; before: string[]; after: string[]; status: "add" | "remove" | "update" }>;
  impactMembers: number;
}> {
  const current = await getSubjectGrants(input);
  const byKey = new Map(current.grants.map((row) => [`${row.resourceType}:${row.resourceId}`, row]));
  const diff: Array<{ resourceType: string; resourceId: string; before: string[]; after: string[]; status: "add" | "remove" | "update" }> = [];

  for (const change of input.changes) {
    const key = `${change.resourceType}:${change.resourceId}`;
    const before = byKey.get(key)?.actions ?? [];
    const after = normalizeActions(change.resourceType, change.actions);
    const status = after.length === 0 && before.length > 0 ? "remove" : before.length === 0 && after.length > 0 ? "add" : "update";
    if (before.join(",") === after.join(",")) continue;
    diff.push({ resourceType: change.resourceType, resourceId: change.resourceId, before, after, status });
  }

  const impactMembers = input.subjectType === "ROLE" ? await countRoleMembers(input.organizationId, input.subjectId) : 1;
  return { diff, impactMembers };
}

/** 矩阵批量读取：返回角色列表 + 资源分组 + 单元格授权。 */
export async function getAccessMatrix(input: { organizationId: string; workspaceId: string }): Promise<{
  roles: Array<{ id: string; name: string; description: string; memberCount: number }>;
  resourceGroups: Array<{ type: string; label: string; resources: Array<{ type: string; id: string; label: string; secondary: string | null }> }>;
  cells: Array<{ subjectId: string; resourceType: string; resourceId: string; actions: string[]; source: string }>;
}> {
  const workspaceId = input.workspaceId || "default";
  const [roleRows, grants] = await Promise.all([
    prisma.organizationRosterRole.findMany({
      where: { organizationId: input.organizationId },
      orderBy: [{ sortOrder: "asc" }],
      select: { id: true, name: true, description: true },
    }),
    prisma.resourceGrant.findMany({
      where: {
        organizationId: input.organizationId,
        subjectType: "ROLE",
        enabled: true,
        OR: [{ workspaceId }, { workspaceId: "default" }],
      },
    }),
  ]);
  const memberCounts = await prisma.organizationMember.groupBy({
    by: ["role"],
    where: { organizationId: input.organizationId },
    _count: { _all: true },
  });
  const countByRole = new Map(memberCounts.map((row) => [row.role, row._count._all]));

  const roles = roleRows.map((row) => ({ ...row, memberCount: countByRole.get(row.id as OrganizationRole) ?? 0 }));
  const resourceGroups = buildResourceGroups().map((group) =>
    group.type === "POINTS"
      ? {
          ...group,
          resources: roles.map((role) => ({ type: "POINTS", id: role.id, label: role.name, secondary: "积分模板" })),
        }
      : group,
  );
  const cells = grants.map((row) => ({
    subjectId: row.subjectId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    actions: row.actions,
    source: row.source,
  }));
  return { roles, resourceGroups, cells };
}

function buildResourceGroups(): Array<{ type: string; label: string; resources: Array<{ type: string; id: string; label: string; secondary: string | null }> }> {
  return [
    {
      type: "MODULE",
      label: "业务功能模块",
      resources: permissionModules.map((mod) => ({ type: "MODULE", id: mod.id, label: mod.name.split(" /")[0], secondary: mod.paths[0] ?? null })),
    },
    {
      type: "SELLFOX_DOMAIN",
      label: "赛狐数据域",
      resources: sellfoxPlanGroups.flatMap((group) => group.items.map((item) => ({ type: "SELLFOX_DOMAIN", id: item.id, label: item.label, secondary: item.table ?? null }))),
    },
    {
      type: "APPROVAL",
      label: "审批单据",
      resources: [
        { type: "APPROVAL", id: "purchase_payment", label: "采购付款", secondary: null },
        { type: "APPROVAL", id: "purchase_refund", label: "采购退款", secondary: null },
        { type: "APPROVAL", id: "wms_inbound", label: "仓库入库", secondary: null },
        { type: "APPROVAL", id: "wms_count", label: "仓库盘点", secondary: null },
        { type: "APPROVAL", id: "agent_change", label: "Agent 变更", secondary: null },
      ],
    },
    {
      type: "POINTS",
      label: "积分额度模板",
      resources: [],
    },
  ];
}

/** 审批矩阵读取：从 ResourceGrant(APPROVAL) 还原金额分级。 */
export async function getApprovalMatrix(input: { organizationId: string; workspaceId: string }): Promise<{
  rows: Array<{ type: string; min: string | null; max: string | null; actions: string[]; scopeJson: Record<string, unknown> | null }>;
  revision: string;
}> {
  const workspaceId = input.workspaceId || "default";
  const rows = await prisma.resourceGrant.findMany({
    where: {
      organizationId: input.organizationId,
      resourceType: "APPROVAL",
      enabled: true,
      OR: [{ workspaceId }, { workspaceId: "default" }],
    },
    orderBy: [{ resourceId: "asc" }],
  });
  return {
    rows: rows.map((row) => ({
      type: row.resourceId,
      min: typeof toScopeJson(row.scopeJson)?.amountMin === "string" ? (toScopeJson(row.scopeJson)!.amountMin as string) : null,
      max: typeof toScopeJson(row.scopeJson)?.amountMax === "string" ? (toScopeJson(row.scopeJson)!.amountMax as string) : null,
      actions: row.actions,
      scopeJson: toScopeJson(row.scopeJson),
    })),
    revision: buildRevision(rows),
  };
}

/** 积分模板（角色级）读取。 */
export async function getPointsTemplates(input: { organizationId: string; workspaceId: string }): Promise<{
  rows: Array<{ roleId: string; quota: string | null; maxRequestAmount: string | null; maxRequestsPerPeriod: number | null }>;
  revision: string;
}> {
  const workspaceId = input.workspaceId || "default";
  const rows = await prisma.resourceGrant.findMany({
    where: {
      organizationId: input.organizationId,
      resourceType: "POINTS",
      subjectType: "ROLE",
      enabled: true,
      OR: [{ workspaceId }, { workspaceId: "default" }],
    },
  });
  return {
    rows: rows.map((row) => {
      const scope = toScopeJson(row.scopeJson) ?? {};
      return {
        roleId: row.subjectId,
        quota: typeof scope.quota === "string" ? scope.quota : null,
        maxRequestAmount: typeof scope.maxRequestAmount === "string" ? scope.maxRequestAmount : null,
        maxRequestsPerPeriod: typeof scope.maxRequestsPerPeriod === "number" ? scope.maxRequestsPerPeriod : null,
      };
    }),
    revision: buildRevision(rows),
  };
}

const MCP_TOOL_NAMES: Record<"amazon" | "sellfox", string[]> = {
  amazon: ["amazon.products.read", "amazon.orders.read", "amazon.ads.read", "amazon.inventory.read", "amazon.finance.read"],
  sellfox: ["sellfox.products.read", "sellfox.orders.read", "sellfox.ads.read", "sellfox.inventory.read", "sellfox.finance.read"],
};

/** MCP 工具授权清单（按 provider 隔离）。 */
export function listMcpScopes(): Record<"amazon" | "sellfox", string[]> {
  return MCP_TOOL_NAMES;
}

export { permissionActions as accessActions };
