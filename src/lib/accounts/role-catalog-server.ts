import { type Prisma } from "@prisma/client";
import { cache } from "react";
import { measureServerOperation } from "@/lib/server/performance";
import { buildDefaultRoleCatalog, type RoleCatalogItem } from "@/lib/accounts/role-catalog";
import { prisma } from "@/lib/db/prisma";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { normalizeCatalogRolePermissions } from "@/lib/accounts/role-permissions-utils";
import { invalidateOrganizationRolePermissions } from "@/lib/accounts/role-permission-cache";

export type RoleCatalogSnapshot = {
  roles: RoleCatalogItem[];
  revision: string;
};

type RoleRow = {
  id: string;
  name: string;
  description: string;
  permissions: Prisma.JsonValue;
  sortOrder: number;
  updatedAt: Date;
};

const defaultRoleCatalog = buildDefaultRoleCatalog();

/** 无任何已知快照时的最小权限集合：保留角色身份，但清空全部授权（fail-closed）。 */
function minimalRoleCatalog(): RoleCatalogItem[] {
  return defaultRoleCatalog.map(role => ({ ...role, permissions: {} }));
}

function buildRevision(rows: Pick<RoleRow, "id" | "updatedAt">[]) {
  const latestUpdatedAt = rows.reduce((latest, row) => Math.max(latest, row.updatedAt.getTime()), 0);

  return `${rows.length}:${latestUpdatedAt}:${rows.map((row) => row.id).sort().join(",")}`;
}

function normalizeRoleRow(row: RoleRow): RoleCatalogItem {
  // A successfully read owner role always has every registered module/action.
  // Failure snapshots remain empty so unavailable authorization still fails closed.
  const permissions = normalizeCatalogRolePermissions(row.id, row.permissions);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions,
    sortOrder: row.sortOrder,
  };
}

async function seedOrganizationRoles(client: typeof prisma | Prisma.TransactionClient, organizationId: string) {
  const existingCount = await client.organizationRosterRole.count({
    where: { organizationId },
  });

  if (existingCount > 0) return;

  const initialRoles = defaultRoleCatalog.map((role) => ({
    organizationId,
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    sortOrder: role.sortOrder,
  }));

  await client.organizationRosterRole.createMany({
    data: initialRoles,
    skipDuplicates: true,
  });
}

export const getOrganizationRoleCatalogSnapshot = cache(async (organizationId: string): Promise<RoleCatalogSnapshot> => {
  if (!process.env.DATABASE_URL) {
    // 本地开发保留默认权限；生产缺少 DATABASE_URL 属于配置错误，按最小权限 fail-closed。
    if (process.env.NODE_ENV === "production") {
      console.warn("[role-catalog] 生产环境未配置 DATABASE_URL，按最小权限处理。");
      return { roles: minimalRoleCatalog(), revision: "no-database-minimal" };
    }
    return {
      roles: defaultRoleCatalog,
      revision: "local-default",
    };
  }

  try {
    let roles = (await measureServerOperation("auth.roles", () => prisma.organizationRosterRole.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
    }))) as RoleRow[];

    // Role catalog is the authorization source of truth; seed definitions for new or
    // partially initialized organizations so the operational permission editor stays consistent.
    if (roles.length === 0) {
      await prisma.$transaction(async (tx) => {
        await seedOrganizationRoles(tx, organizationId);
      });
      roles = (await prisma.organizationRosterRole.findMany({
        where: { organizationId },
        orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
      })) as RoleRow[];
    }

    const snapshot: RoleCatalogSnapshot = {
      roles: roles.map(normalizeRoleRow),
      revision: buildRevision(roles),
    };
    return snapshot;
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.warn(`[role-catalog] 数据库不可用，按最小权限处理 ${organizationId}:`, error);
      return {
        roles: minimalRoleCatalog(),
        revision: "database-unavailable-minimal",
      };
    }

    throw error;
  }
});

export async function readOrganizationRolePermissions(client: Prisma.TransactionClient, organizationId: string) {
  const roles = await client.organizationRosterRole.findMany({ where: { organizationId } });
  return Object.fromEntries(roles.map(role => {
    const normalized = normalizeRoleRow(role as RoleRow);
    return [normalized.id, normalized.permissions];
  }));
}

export async function saveOrganizationRoleCatalog(organizationId: string, roles: RoleCatalogItem[]): Promise<RoleCatalogSnapshot> {
  if (!process.env.DATABASE_URL) {
    return {
      roles: roles.map(role => ({ ...role, permissions: normalizeCatalogRolePermissions(role.id, role.permissions) })),
      revision: "local",
    };
  }

  const normalizedRoles = roles
    .filter((role) => Boolean(role.id.trim()) && Boolean(role.name.trim()))
    .map((role, index) => ({
      organizationId,
      id: role.id.trim(),
      name: role.name.trim(),
      description: role.description.trim(),
      permissions: normalizeCatalogRolePermissions(role.id.trim(), role.permissions),
      sortOrder: Number.isFinite(role.sortOrder) ? role.sortOrder : index,
    }));

  const saved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ locked: number }[]>`SELECT 1::int AS "locked" FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;

    await tx.organizationRosterRole.deleteMany({
      where: {
        organizationId,
        ...(normalizedRoles.length
          ? {
              id: {
                notIn: normalizedRoles.map((role) => role.id),
              },
            }
          : {}),
      },
    });

    for (const role of normalizedRoles) {
      await tx.organizationRosterRole.upsert({
        where: {
          organizationId_id: {
            organizationId,
            id: role.id,
          },
        },
        create: role,
        update: {
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          sortOrder: role.sortOrder,
        },
      });
    }

    return tx.organizationRosterRole.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
    });
  });

  // Invalidate only after the transaction commits — never inside it, so a
  // rollback cannot leave a stale-empty cache window.
  invalidateOrganizationRolePermissions(organizationId);

  return {
    roles: saved.map((role) => normalizeRoleRow(role as RoleRow)),
    revision: buildRevision(saved as Array<Pick<RoleRow, "id" | "updatedAt">>),
  };
}
