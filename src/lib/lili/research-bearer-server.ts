import { prisma } from "@/lib/db/prisma";
import { authenticateAmazonMcp } from "@/lib/amazon-sync/mcp";
import { assertAmazonAction } from "@/lib/amazon-sync/data-access";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { NextResponse } from "next/server";
import type { ResearchBearerDependencies } from "./research-bearer-mcp";

/** Reuses credential authentication and live organization membership; never creates a browser session. */
export const researchBearerDependencies: ResearchBearerDependencies = {
  async authenticate(authorization, request) {
    return authenticateAmazonMcp(authorization, request ? new URL("/api/lili/mcp", process.env.LILI_PUBLIC_ORIGIN || request.url).href : undefined);
  },
  async marketAccess(identity, request) {
    const { marketAccessSummary } = await import("./market-access");
    const permission = await researchBearerDependencies.permission(identity, "agents", "edit", request);
    const canResearch = identity.tools.includes("research_step") && permission.ok;
    if (!canResearch) return marketAccessSummary(true, false, []);
    const { getSellerSpriteMcpSettings } = await import("@/lib/server/integration-settings");
    const { toolConfigStore } = await import("./tool-config-server");
    const user = { id: identity.userId, organizationId: identity.organizationId };
    const [seller, xiyou] = await Promise.allSettled([
      getSellerSpriteMcpSettings(user, { workspaceId: identity.workspaceId, accountId: "", marketplace: "" }),
      toolConfigStore.read({ organizationId: identity.organizationId, userId: identity.userId, workspaceId: identity.workspaceId }),
    ]);
    const state = (configured: boolean) => configured ? "configured_not_probed" as const : "disabled_or_missing" as const;
    const sellerConfigured = seller.status === "fulfilled" && Boolean(seller.value.enabled && seller.value.apiKey && seller.value.serverUrl);
    const xiyouConfigured = xiyou.status === "fulfilled" && Boolean(xiyou.value.enabled && xiyou.value.mcpToken);
    const { readPaidCallConsent } = await import("@/lib/selection-research/paid-call-consent");
    const consent = await readPaidCallConsent({ organizationId: identity.organizationId, workspaceId: identity.workspaceId, ownerId: identity.userId });
    const summary = marketAccessSummary(true, true, [
      { provider: "sellersprite", configured: sellerConfigured, status: seller.status === "rejected" ? "configuration_unavailable" : state(sellerConfigured) },
      { provider: "xiyou", configured: xiyouConfigured, status: xiyou.status === "rejected" ? "configuration_unavailable" : state(xiyouConfigured) },
    ]);
    return consent ? { ...summary, approval_required: false, reason: "SAVED_PAID_RESEARCH_CONSENT", paid_call_consent: consent } : summary;
  },
  async erp(identity) {
    const { createErpResearchTransport } = await import("./runtime-server");
    const result = await createErpResearchTransport({ organizationId: identity.organizationId, workspaceId: identity.workspaceId, userId: identity.userId }, identity.id);
    if (!result.transport) throw new Error("ERP_GRANT_UNAVAILABLE");
    return result.transport;
  },
  async permission(identity, moduleId, action, request) {
    const denied = () => ({ ok: false as const, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) });
    const url = new URL(request.url);
    if ([url.searchParams.get("workspaceId"), request.headers.get("x-workspace-id")].some(value => value !== null && value !== identity.workspaceId)) return denied();
    const member = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: identity.organizationId, userId: identity.userId } }, select: { role: true, user: { select: { id: true, name: true, email: true, status: true } }, organization: { select: { name: true } } } });
    if (!member || member.user.status !== "active" || !await assertWorkspaceAccess(identity.organizationId, identity.workspaceId)) return denied();
    // The MCP live checker fails closed on DB errors and does not seed role settings on read.
    try { await assertAmazonAction(identity, identity.userId, action, prisma, moduleId); }
    catch (error) { if (error instanceof SyncInputError && error.status === 403) return denied(); throw error; }
    return { ok: true, user: { id: member.user.id, organizationId: identity.organizationId, organizationName: member.organization.name, role: member.role, email: member.user.email, name: member.user.name } };
  },
  async audit(identity, event) {
    if (event.status === "SUCCEEDED") await prisma.amazonMcpCredential.updateMany({ where: { id: identity.id, status: "ACTIVE", revision: identity.revision }, data: { lastUsedAt: new Date() } });
    await prisma.auditLog.create({ data: { organizationId: identity.organizationId, userId: identity.userId, action: `lili.mcp.${event.status.toLowerCase()}`, entityType: "AmazonMcpCredential", entityId: identity.id,
      metadata: { workspaceId: identity.workspaceId, credentialId: identity.id, credentialRevision: identity.revision, ...event } } });
  },
};
