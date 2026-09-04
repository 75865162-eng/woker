import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  defaultSellerSpriteMcpSettings,
  mergeSellerSpriteMcpSettings,
  normalizeSellerSpriteMcpSettings,
  parseSellerSpriteMcpSettings,
  sellerSpriteIntegrationProvider,
  toPublicSellerSpriteMcpSettings,
  type SellerSpriteMcpPublicSettings,
  type SellerSpriteMcpSettings,
} from "@/lib/integrations/sellersprite";

type UserScope = {
  organizationId: string;
  id: string;
};

type WorkspaceScope = {
  workspaceId: string;
  accountId: string;
  marketplace: string;
};

export async function getSellerSpriteMcpSettings(user: UserScope, scope: WorkspaceScope): Promise<SellerSpriteMcpSettings> {
  try {
    const record = await prisma.externalIntegrationSetting.findUnique({
      where: {
        organizationId_workspaceId_userId_provider: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
          provider: sellerSpriteIntegrationProvider,
        },
      },
    });

    return parseSellerSpriteMcpSettings(record?.config);
  } catch {
    return defaultSellerSpriteMcpSettings;
  }
}

export async function getPublicSellerSpriteMcpSettings(user: UserScope, scope: WorkspaceScope): Promise<SellerSpriteMcpPublicSettings> {
  return toPublicSellerSpriteMcpSettings(await getSellerSpriteMcpSettings(user, scope));
}

export async function saveSellerSpriteMcpSettings(
  user: UserScope,
  scope: WorkspaceScope,
  submitted: Partial<SellerSpriteMcpSettings>,
) {
  const existing = await getSellerSpriteMcpSettings(user, scope);
  const settings = mergeSellerSpriteMcpSettings(submitted, existing);

  await prisma.externalIntegrationSetting.upsert({
    where: {
      organizationId_workspaceId_userId_provider: {
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
        userId: user.id,
        provider: sellerSpriteIntegrationProvider,
      },
    },
    create: {
      organizationId: user.organizationId,
      userId: user.id,
      workspaceId: scope.workspaceId,
      accountId: scope.accountId,
      marketplace: scope.marketplace,
      provider: sellerSpriteIntegrationProvider,
      displayName: "SellerSprite MCP",
      enabled: settings.enabled,
      config: settings as unknown as Prisma.InputJsonValue,
    },
    update: {
      accountId: scope.accountId,
      marketplace: scope.marketplace,
      displayName: "SellerSprite MCP",
      enabled: settings.enabled,
      config: settings as unknown as Prisma.InputJsonValue,
    },
  });

  return settings;
}

export function createSellerSpriteMcpStatus(settings: SellerSpriteMcpPublicSettings) {
  if (!settings.enabled) return "disabled";
  if (!settings.configured) return "missing_credentials";

  return "configured";
}

export function normalizeSubmittedSellerSpriteMcpSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalizeSellerSpriteMcpSettings(null);
  }

  return normalizeSellerSpriteMcpSettings(value as Partial<SellerSpriteMcpSettings>);
}
