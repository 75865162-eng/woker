import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { seal, unseal } from "@/lib/amazon-sync/approval-policy";
import { defaultXiyouSettings, mergeXiyouSettings, publicXiyouSettings, xiyouProvider, type XiyouSettings } from "./tool-config";

export type ToolConfigScope = { organizationId: string; workspaceId: string; userId: string };
export type ToolConfigStore = {
  read(scope: ToolConfigScope): Promise<XiyouSettings>;
  save(scope: ToolConfigScope, patch: unknown): Promise<XiyouSettings>;
};
const purpose = "lili-xiyou-configuration.v1";
const identity = (scope: ToolConfigScope) => JSON.stringify([scope.userId, xiyouProvider]);

export function encryptXiyouSettings(settings: XiyouSettings, scope: ToolConfigScope) {
  return { version: 1, ciphertext: seal(settings, scope, identity(scope), purpose) };
}
export function decryptXiyouSettings(config: unknown, scope: ToolConfigScope): XiyouSettings {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid saved configuration");
  const value = config as Record<string, unknown>;
  if (value.version !== 1 || typeof value.ciphertext !== "string") throw new Error("Invalid saved configuration");
  return mergeXiyouSettings(unseal(value.ciphertext, scope, identity(scope), purpose));
}
const where = (scope: ToolConfigScope) => ({ organizationId_workspaceId_userId_provider: { ...scope, provider: xiyouProvider } });

/** Reuses the host integration table. No dotenv writes, legacy import or plaintext fallback. */
export const toolConfigStore: ToolConfigStore = {
  async read(scope) {
    const row = await prisma.externalIntegrationSetting.findUnique({ where: where(scope), select: { config: true } });
    return row ? decryptXiyouSettings(row.config, scope) : { ...defaultXiyouSettings };
  },
  async save(scope, patch) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["lili-tool-config", scope])}, 0))`;
      const row = await tx.externalIntegrationSetting.findUnique({ where: where(scope), select: { config: true } });
      const settings = mergeXiyouSettings(patch, row ? decryptXiyouSettings(row.config, scope) : defaultXiyouSettings);
      const config = encryptXiyouSettings(settings, scope) as Prisma.InputJsonValue;
      const saved = await tx.externalIntegrationSetting.upsert({
        where: where(scope),
        create: { ...scope, provider: xiyouProvider, displayName: "西柚洞察 MCP", enabled: settings.enabled, config },
        update: { enabled: settings.enabled, config },
        select: { id: true },
      });
      const previous = await tx.dataChangeVersion.aggregate({ where: {
        organizationId: scope.organizationId, workspaceId: scope.workspaceId,
        entityType: "external_integration_setting", entityId: saved.id,
      }, _max: { version: true } });
      const version = (previous._max.version ?? 0) + 1;
      await tx.dataChangeVersion.create({ data: {
        organizationId: scope.organizationId, userId: scope.userId, workspaceId: scope.workspaceId,
        entityType: "external_integration_setting", entityId: saved.id, version,
        action: "external_integration_setting_save", summary: "西柚洞察 MCP",
        payload: publicXiyouSettings(settings) as Prisma.InputJsonValue,
      } });
      await tx.auditLog.create({ data: {
        organizationId: scope.organizationId, userId: scope.userId,
        action: "external_integration_setting_save", entityType: "external_integration_setting", entityId: saved.id,
        metadata: { workspaceId: scope.workspaceId, provider: xiyouProvider, version, enabled: settings.enabled,
          configured: publicXiyouSettings(settings).configured, tokenReplaced: Boolean((patch as Record<string, unknown>).mcpToken),
          clientSecretReplaced: Boolean((patch as Record<string, unknown>).clientSecret) },
      } });
      return settings;
    });
  },
};
