import {
  createDefaultAiSettingsBundle,
  normalizeAiSettingsBundle,
  toPublicAiSettings,
  type AiModelSettings,
  type AiModelSettingsPublic,
} from "@/lib/ai-settings";
import { prisma } from "@/lib/db/prisma";

type UserScope = {
  organizationId: string;
  id: string;
};

type WorkspaceScope = {
  workspaceId: string;
  accountId: string;
  marketplace: string;
};

export async function resolveUserAiTextSettings(user: UserScope, scope: WorkspaceScope): Promise<AiModelSettings> {
  try {
    const record = await prisma.aiModelSetting.findUnique({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
    });

    if (!record) return createDefaultAiSettingsBundle().text;

    return normalizeAiSettingsBundle(record.settings as Partial<{ text: AiModelSettings }>).text;
  } catch {
    return createDefaultAiSettingsBundle().text;
  }
}

export async function resolvePublicUserAiTextSettings(user: UserScope, scope: WorkspaceScope): Promise<AiModelSettingsPublic> {
  return toPublicAiSettings(await resolveUserAiTextSettings(user, scope));
}
