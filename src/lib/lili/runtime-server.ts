import { prisma } from "@/lib/db/prisma";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { getSellerSpriteMcpSettings } from "@/lib/server/integration-settings";
import { listSellerSpriteRemoteTools, callSellerSpriteRemoteTool } from "@/lib/integrations/sellersprite";
import { toolConfigStore } from "./tool-config-server";
import { createLiliTransport } from "@/lib/selection-research/lili-transport";
import { sellerSpritePolicy } from "@/lib/selection-research/seller-transport";
import { createRuntimeTools, xiyouResearchReadTools, type RuntimeProvider } from "./runtime-tools";
import type { Transport } from "@/lib/selection-research/types";

/** Uses an existing, explicitly granted personal MCP credential. Session access never creates a grant. */
export async function createErpResearchTransport(scope: { organizationId: string; workspaceId: string; userId: string }, credentialId?: string): Promise<{ transport?: Transport; reason?: string; credentialId?: string }> {
  const identities = await prisma.amazonMcpCredential.findMany({ where: { ...scope, status: "ACTIVE", expiresAt: { gt: new Date() }, ...(credentialId ? { id: credentialId } : {}) }, take: 2 });
  if (!identities.length) return { reason: "ERP_PERSONAL_MCP_GRANT_REQUIRED" };
  if (identities.length !== 1) return { reason: "ERP_MCP_CREDENTIAL_SELECTION_REQUIRED" };
  const identity = identities[0];
  const { listDiscoverableAmazonMcpTools, invokeAmazonMcp } = await import("@/lib/amazon-sync/mcp");
  return { credentialId: identity.id, transport: {
    async listTools() { return await listDiscoverableAmazonMcpTools(identity, "2025-06-18") as unknown as Awaited<ReturnType<Transport["listTools"]>>; },
    async callTool(name, args, signal) {
      // Existing gateway revalidates credential, current role, workspace and seller/marketplace grants.
      return await invokeAmazonMcp(identity, name, args, undefined, signal) as never;
    },
  } };
}

export async function runtimeToolsForUser(user: { id: string; organizationId: string }, request: Request, body: Record<string, unknown> = {}) {
  const { workspaceId } = workspaceScopeFromRequest(request, body);
  if (!await assertWorkspaceAccess(user.organizationId, workspaceId)) throw new Error("RESEARCH_SCOPE_DENIED");
  const scope = { organizationId: user.organizationId, userId: user.id, workspaceId };
  const settingsScope = { workspaceId, accountId: "", marketplace: "" };
  // Configuration failures are isolated per source; secrets remain inside server adapters.
  const providers: RuntimeProvider[] = [];
  let erpCredentialId: string | undefined;
  try {
    const erp = await createErpResearchTransport(scope, typeof body.erpCredentialId === "string" ? body.erpCredentialId : undefined);
    erpCredentialId = erp.credentialId;
    providers.push({ id: "erp", ...erp, isReadOnly: tool => tool.annotations?.readOnlyHint === true });
  } catch { providers.push({ id: "erp", reason: "ERP_MCP_CONFIGURATION_UNAVAILABLE", isReadOnly: () => false }); }
  try {
    const settings = await getSellerSpriteMcpSettings(user, settingsScope);
    providers.push({ id: "sellersprite", isReadOnly: tool => tool.annotations?.readOnlyHint !== false && Boolean(sellerSpritePolicy(tool)),
      ...(settings.enabled && settings.apiKey ? { transport: {
        async listTools() { return await listSellerSpriteRemoteTools(settings) as never; },
        async callTool(name, args, signal, schema) { return await callSellerSpriteRemoteTool(settings, name, args, signal, schema) as never; },
      } as Transport } : { reason: "SELLERSPRITE_MCP_NOT_CONFIGURED" }) });
  } catch { providers.push({ id: "sellersprite", reason: "SELLERSPRITE_CONFIGURATION_UNAVAILABLE", isReadOnly: () => false }); }
  try {
    const settings = await toolConfigStore.read(scope);
    providers.push({ id: "xiyou", isReadOnly: tool => tool.annotations?.readOnlyHint !== false && xiyouResearchReadTools.has(tool.name),
      ...(settings.enabled && settings.mcpToken ? { transport: createLiliTransport({ endpoint: settings.mcpUrl, authorization: `Bearer ${settings.mcpToken}` }) } : { reason: "XIYOU_MCP_NOT_CONFIGURED" }) });
  } catch { providers.push({ id: "xiyou", reason: "XIYOU_CONFIGURATION_UNAVAILABLE", isReadOnly: () => false }); }
  return { ...createRuntimeTools(providers), erpCredentialId };
}
