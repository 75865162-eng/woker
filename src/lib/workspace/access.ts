import { prisma } from "@/lib/db/prisma";

/** Validate a requested workspace against the authenticated organization. */
export async function assertWorkspaceAccess(
  organizationId: string,
  workspaceId: string,
  client: Pick<typeof prisma, "workspaceScope"> = prisma,
) {
  const workspace = await client.workspaceScope.findUnique({
    where: { organizationId_id: { organizationId, id: workspaceId } },
    select: { id: true },
  });
  return Boolean(workspace);
}
