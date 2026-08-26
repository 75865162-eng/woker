import { prisma } from "@/lib/db/prisma";

export async function ensureOrganization(organizationId: string, organizationName?: string) {
  return prisma.organization.upsert({
    where: {
      id: organizationId,
    },
    update: {},
    create: {
      id: organizationId,
      name: organizationName?.trim() || organizationId,
      slug: organizationId,
    },
  });
}
