import { prisma } from "@/lib/db/prisma";
import { normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";

/**
 * 账号权限中心回填：把旧授权数据投影进统一 ResourceGrant 表。
 * 幂等、可重复执行；source=MIGRATED 的记录不会覆盖已存在的 MANUAL 记录。
 * 迁移期不删旧表，双读由 effective-access service 负责。
 */

const DEFAULT_WORKSPACE = "default";

type BackfillStats = {
  roleModules: number;
  amazonMemberGrants: number;
  amazonRoleGrants: number;
  skippedManual: number;
};

function scopeValue(value: unknown) {
  // 金额与站点等可变维度进 scopeJson；金额一律字符串（本脚本无金额，仅站点/mcp）。
  return value === null || value === undefined ? null : (value as object);
}

async function upsertMigrated(
  data: {
    organizationId: string;
    workspaceId: string;
    subjectType: string;
    subjectId: string;
    resourceType: string;
    resourceId: string;
    scopeJson?: object | null;
    actions: string[];
    source: string;
  },
  stats: BackfillStats,
) {
  const where = {
    organizationId_workspaceId_subjectType_subjectId_resourceType_resourceId: {
      organizationId: data.organizationId,
      workspaceId: data.workspaceId,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
    },
  };
  const existing = await prisma.resourceGrant.findUnique({ where });
  if (existing && existing.source !== "MIGRATED") {
    stats.skippedManual += 1;
    return;
  }
  await prisma.resourceGrant.upsert({
    where,
    create: {
      organizationId: data.organizationId,
      workspaceId: data.workspaceId,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      scopeJson: data.scopeJson ?? undefined,
      actions: data.actions,
      source: data.source,
    },
    update: {
      scopeJson: data.scopeJson ?? undefined,
      actions: data.actions,
      source: data.source,
    },
  });
}

async function backfillRoleModules(stats: BackfillStats) {
  const roles = await prisma.organizationRosterRole.findMany({
    select: { organizationId: true, id: true, permissions: true },
  });
  for (const role of roles) {
    const permissions = normalizeRolePermissions(role.permissions);
    for (const [moduleId, actions] of Object.entries(permissions)) {
      if (!actions.length) continue;
      await upsertMigrated(
        {
          organizationId: role.organizationId,
          workspaceId: DEFAULT_WORKSPACE,
          subjectType: "ROLE",
          subjectId: role.id,
          resourceType: "MODULE",
          resourceId: moduleId,
          actions: [...actions],
          source: "MIGRATED",
        },
        stats,
      );
      stats.roleModules += 1;
    }
  }
}

async function backfillAmazonGrants(stats: BackfillStats) {
  const memberGrants = await prisma.amazonDataAccessGrant.findMany({
    where: { enabled: true },
    select: {
      organizationId: true,
      workspaceId: true,
      userId: true,
      sellerAccountId: true,
      marketplaceIds: true,
      actions: true,
      mcpEnabled: true,
    },
  });
  for (const grant of memberGrants) {
    const actions = [...new Set([...grant.actions, ...(grant.mcpEnabled ? ["mcp"] : [])])];
    await upsertMigrated(
      {
        organizationId: grant.organizationId,
        workspaceId: grant.workspaceId,
        subjectType: "MEMBER",
        subjectId: grant.userId,
        resourceType: "AMAZON_SELLER",
        resourceId: grant.sellerAccountId,
        scopeJson: scopeValue({ marketplaceIds: grant.marketplaceIds }) ?? undefined,
        actions,
        source: "MIGRATED",
      },
      stats,
    );
    stats.amazonMemberGrants += 1;
  }

  const roleGrants = await prisma.amazonRoleDataAccessGrant.findMany({
    where: { enabled: true },
    select: {
      organizationId: true,
      workspaceId: true,
      roleId: true,
      sellerAccountId: true,
      marketplaceIds: true,
      actions: true,
      mcpEnabled: true,
    },
  });
  for (const grant of roleGrants) {
    const actions = [...new Set([...grant.actions, ...(grant.mcpEnabled ? ["mcp"] : [])])];
    await upsertMigrated(
      {
        organizationId: grant.organizationId,
        workspaceId: grant.workspaceId,
        subjectType: "ROLE",
        subjectId: grant.roleId,
        resourceType: "AMAZON_SELLER",
        resourceId: grant.sellerAccountId,
        scopeJson: scopeValue({ marketplaceIds: grant.marketplaceIds }) ?? undefined,
        actions,
        source: "MIGRATED",
      },
      stats,
    );
    stats.amazonRoleGrants += 1;
  }
}

async function main() {
  const startedAt = performance.now();
  const stats: BackfillStats = {
    roleModules: 0,
    amazonMemberGrants: 0,
    amazonRoleGrants: 0,
    skippedManual: 0,
  };

  await backfillRoleModules(stats);
  await backfillAmazonGrants(stats);

  const durationMs = Math.round(performance.now() - startedAt);
  console.log(
    `[access-backfill] roleModules=${stats.roleModules} amazonMemberGrants=${stats.amazonMemberGrants} ` +
      `amazonRoleGrants=${stats.amazonRoleGrants} skippedManual=${stats.skippedManual} in ${durationMs}ms`,
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown access backfill error.";
    console.error("[access-backfill] failed:", message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
