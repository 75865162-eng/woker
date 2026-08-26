import { OrganizationRole } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { type CurrentUser } from "@/lib/auth/session";

type OrganizationRoleValue = (typeof OrganizationRole)[keyof typeof OrganizationRole];

const organizationRoleIds = new Set<string>(Object.values(OrganizationRole));

function toOrganizationRole(role: string): OrganizationRoleValue {
  return organizationRoleIds.has(role) ? (role as OrganizationRoleValue) : OrganizationRole.viewer;
}

export async function ensureCurrentUserRecord(user: CurrentUser) {
  await prisma.organization.upsert({
    where: { id: user.organizationId },
    update: {
      name: user.organizationName,
    },
    create: {
      id: user.organizationId,
      name: user.organizationName,
      slug: user.organizationId,
    },
  });

  await prisma.user.upsert({
    where: { id: user.id },
    update: {
      email: user.email,
      name: user.name,
      status: "active",
    },
    create: {
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: hashPassword("__local_session_placeholder__"),
      status: "active",
    },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: user.organizationId,
        userId: user.id,
      },
    },
    update: {
      role: toOrganizationRole(user.role),
    },
    create: {
      organizationId: user.organizationId,
      userId: user.id,
      role: toOrganizationRole(user.role),
    },
  });
}
