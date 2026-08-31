import { type Prisma } from "@prisma/client";
import { buildDefaultRoleCatalog, type RoleCatalogItem } from "@/lib/accounts/role-catalog";
import { prisma } from "@/lib/db/prisma";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { normalizeRolePermissionMap, normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";

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

function buildRevision(rows: Pick<RoleRow, "id" | "updatedAt">[]) {
  const latestUpdatedAt = rows.reduce((latest, row) => Math.max(latest, row.updatedAt.getTime()), 0);

  return `${rows.length}:${latestUpdatedAt}:${rows.map((row) => row.id).sort().join(",")}`;
}

function normalizeRoleRow(row: RoleRow): RoleCatalogItem {
  const permissions = normalizeRolePermissions(row.permissions);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions,
    sortOrder: row.sortOrder,
  };
}

async function readLegacyPermissions(client: typeof prisma | Prisma.TransactionClient, organizationId: string) {
  const legacy = await client.organizationRolePermission.findUnique({
    where: { organizationId },
  });

  return normalizeRolePermissionMap(legacy?.permissions);
}

async function seedOrganizationRoles(client: typeof prisma | Prisma.TransactionClient, organizationId: string) {
  const existingCount = await client.organizationRosterRole.count({
    where: { organizationId },
  });

  if (existingCount > 0) return;

  const legacyPermissions = await readLegacyPermissions(client, organizationId);
  const mergedRoles = defaultRoleCatalog.map((role) => ({
    organizationId,
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: legacyPermissions[role.id] ?? role.permissions,
    sortOrder: role.sortOrder,
  }));

  await client.organizationRosterRole.createMany({
    data: mergedRoles,
    skipDuplicates: true,
  });
}

export async function getOrganizationRoleCatalogSnapshot(organizationId: string): Promise<RoleCatalogSnapshot> {
  if (!process.env.DATABASE_URL) {
    return {
      roles: defaultRoleCatalog,
      revision: "local-default",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await seedOrganizationRoles(tx, organizationId);
    });

    const roles = (await prisma.organizationRosterRole.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
    })) as RoleRow[];

    return {
      roles: roles.map(normalizeRoleRow),
      revision: buildRevision(roles),
    };
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.warn(`[role-catalog] Falling back to default roles for ${organizationId}:`, error);
      return {
        roles: defaultRoleCatalog,
        revision: "database-unavailable",
      };
    }

    throw error;
  }
}

export async function saveOrganizationRoleCatalog(organizationId: string, roles: RoleCatalogItem[]): Promise<RoleCatalogSnapshot> {
  if (!process.env.DATABASE_URL) {
    return {
      roles,
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
      permissions: normalizeRolePermissions(role.permissions),
      sortOrder: Number.isFinite(role.sortOrder) ? role.sortOrder : index,
    }));

  if (!normalizedRoles.length) {
    throw new Error("至少保留一个角色。");
  }

  const saved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;

    const currentAccounts = await tx.teamRosterMember.findMany({
      where: { organizationId },
      select: { roleId: true },
    });
    const protectedRoleIds = new Set(currentAccounts.map((account) => account.roleId));
    const nextRoleIds = new Set(normalizedRoles.map((role) => role.id));
    const deletedRoleIds = Array.from(protectedRoleIds).filter((roleId) => !nextRoleIds.has(roleId));

    if (deletedRoleIds.length) {
      const blockedRole = currentAccounts.find((account) => deletedRoleIds.includes(account.roleId));
      if (blockedRole) {
        throw new Error("已有成员绑定的角色不能删除。");
      }
    }

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

  return {
    roles: saved.map((role) => normalizeRoleRow(role as RoleRow)),
    revision: buildRevision(saved as Array<Pick<RoleRow, "id" | "updatedAt">>),
  };
}
