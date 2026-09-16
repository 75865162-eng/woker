import type { AiModelSettingsPublic } from "@/lib/ai-settings";
import type { SellerSpriteMcpPublicSettings } from "@/lib/integrations/sellersprite";
import { createSellerSpriteMcpStatus, getPublicSellerSpriteMcpSettings } from "@/lib/server/integration-settings";
import { resolvePublicUserAiTextSettings } from "@/lib/server/user-ai-settings";

type UserScope = {
  organizationId: string;
  id: string;
};

type WorkspaceScope = {
  workspaceId: string;
  accountId: string;
  marketplace: string;
};

export interface AgentRuntimeConfigStatus {
  ai: AiModelSettingsPublic;
  integrations: {
    sellerSprite: SellerSpriteMcpPublicSettings & {
      status: "disabled" | "missing_credentials" | "configured";
    };
  };
}

export async function resolveAgentRuntimeConfigStatus(user: UserScope, scope: WorkspaceScope): Promise<AgentRuntimeConfigStatus> {
  const [ai, sellerSprite] = await Promise.all([
    resolvePublicUserAiTextSettings(user, scope),
    getPublicSellerSpriteMcpSettings(user, scope),
  ]);

  return {
    ai,
    integrations: {
      sellerSprite: {
        ...sellerSprite,
        status: createSellerSpriteMcpStatus(sellerSprite),
      },
    },
  };
}
