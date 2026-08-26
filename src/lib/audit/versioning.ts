import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { ensureOrganization } from "@/lib/organizations/organization-server";
import { normalizeWorkspaceScope, type WorkspaceScopeInput } from "@/lib/workspace/scope";

export type VersionedEntityType = "product" | "listing_ai_workspace" | "ppc_workspace_snapshot" | "rule_config";

type RecordVersionInput = {
  user: CurrentUser;
  entityType: VersionedEntityType;
  entityId: string;
  action: string;
  summary?: string;
  payload: Prisma.InputJsonValue;
  scope?: Partial<WorkspaceScopeInput>;
};

export async function ensureWorkspaceScope(user: CurrentUser, scope?: Partial<WorkspaceScopeInput>) {
  const normalized = normalizeWorkspaceScope(scope);

  await ensureOrganization(user.organizationId, user.organizationName);

  await prisma.workspaceScope.upsert({
    where: {
      organizationId_id: {
        organizationId: user.organizationId,
        id: normalized.workspaceId,
      },
    },
    create: {
      organizationId: user.organizationId,
      id: normalized.workspaceId,
      name: normalized.workspaceId === "default" ? "默认工作区" : normalized.workspaceId,
      accountId: normalized.accountId,
      marketplace: normalized.marketplace,
      isDefault: normalized.workspaceId === "default",
    },
    update: {
      accountId: normalized.accountId,
      marketplace: normalized.marketplace,
    },
  });

  return normalized;
}

export async function recordDataChangeVersion(input: RecordVersionInput) {
  const scope = await ensureWorkspaceScope(input.user, input.scope);
  const latest = await prisma.dataChangeVersion.aggregate({
    where: {
      organizationId: input.user.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
    },
    _max: {
      version: true,
    },
  });
  const version = (latest._max.version ?? 0) + 1;

  await prisma.$transaction([
    prisma.dataChangeVersion.create({
      data: {
        organizationId: input.user.organizationId,
        userId: input.user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        entityType: input.entityType,
        entityId: input.entityId,
        version,
        action: input.action,
        summary: input.summary,
        payload: input.payload,
      },
    }),
    prisma.auditLog.create({
      data: {
        organizationId: input.user.organizationId,
        userId: input.user.id,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: {
          version,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          summary: input.summary,
        },
      },
    }),
  ]);

  return version;
}
