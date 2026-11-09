import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { assertAmazonAction } from "@/lib/amazon-sync/data-access";
import type { Scope } from "./types";

export const paidCallConsentProvider = "lili-research-paid-consent-v1";
const key = (scope: Scope) => ({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId: scope.ownerId, provider: paidCallConsentProvider });
export type PaidCallConsent = { id: string; approvedAt: string; approvedByUserId: string };
export async function readPaidCallConsent(scope: Scope): Promise<PaidCallConsent | undefined> {
  const row = await prisma.externalIntegrationSetting.findUnique({ where: { organizationId_workspaceId_userId_provider: key(scope) }, select: { enabled: true, config: true } });
  const config = row?.config as Record<string, unknown> | undefined;
  if (!row?.enabled || config?.version !== 1 || config.approvedByUserId !== scope.ownerId || typeof config.id !== "string" || typeof config.approvedAt !== "string") return undefined;
  return { id: config.id, approvedAt: config.approvedAt, approvedByUserId: scope.ownerId };
}
/** Trusted operator only, following explicit human consent. Never expose as a model/MCP command. */
export async function savePaidCallConsent(scope: Scope, enabled: boolean) {
  return prisma.$transaction(async tx => {
    await assertAmazonAction(scope, scope.ownerId, "approve", tx, "agents");
    const consent = { version: 1, id: randomUUID(), approvedAt: new Date().toISOString(), approvedByUserId: scope.ownerId };
    const saved = await tx.externalIntegrationSetting.upsert({
      where: { organizationId_workspaceId_userId_provider: key(scope) },
      create: { ...key(scope), displayName: "Lili 付费研究一次授权自动运行", enabled, config: consent },
      update: { enabled, config: consent }, select: { id: true },
    });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.ownerId, action: "lili.research.paid_consent.saved", entityType: "external_integration_setting", entityId: saved.id,
      metadata: { workspaceId: scope.workspaceId, enabled, consentId: consent.id, purpose: "Human explicitly authorized paid research without repeated page approval; task limits and business gates retained." } } });
    return consent;
  });
}
