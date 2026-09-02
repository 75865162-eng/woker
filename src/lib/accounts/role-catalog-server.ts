import { type Prisma } from "@prisma/client";
import { buildDefaultRoleCatalog, type RoleCatalogItem } from "@/lib/accounts/role-catalog";
import { prisma } from "@/lib/db/prisma";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";

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

export async function getOrganizationRoleCatalogSnapshot(organizationId: string): Promise<RoleCatalogSnapshot> {
  if (!process.env.DATABASE_URL) {
    return {
      roles: defaultRoleCatalog,
      revision: "local-default",
    };
  }

  try {
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

  const saved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;

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
