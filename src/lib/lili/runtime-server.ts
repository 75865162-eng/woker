import { researchRequestAuthorization } from "@/lib/selection-research/request-authorization";
import { assertAmazonAction } from "@/lib/amazon-sync/data-access";
import { liveMarketTransport } from "./market-access";
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
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { SyncInputError } from "@/lib/amazon-sync/policy";

/** ERP sessions use their own user identity; bearer callers retain their exact credential. */
export async function createErpResearchTransport(scope: { organizationId: string; workspaceId: string; userId: string }, credentialId?: string, assertSession?: () => Promise<void>): Promise<{ transport?: Transport; reason?: string; credentialId?: string }> {
  await assertSession?.();
  const { listDiscoverableAmazonMcpTools, invokeAmazonMcp, createErpSessionAmazonMcpIdentity, validateAmazonMcpCredential } = await import("@/lib/amazon-sync/mcp");
  const credential = credentialId ? await prisma.amazonMcpCredential.findFirst({ where: { ...scope, id: credentialId, status: "ACTIVE", expiresAt: { gt: new Date() } } }) : undefined;
  if (credentialId && !credential) return { reason: "ERP_PERSONAL_MCP_CREDENTIAL_INVALID" };
  const identity = credential ? await validateAmazonMcpCredential(credential) : await createErpSessionAmazonMcpIdentity(scope);
  return { ...(credential ? { credentialId: credential.id } : {}), transport: {
    async listTools() {
      await assertSession?.();
      const tools = await listDiscoverableAmazonMcpTools(identity, "2025-06-18");
      await assertSession?.();
      return tools as unknown as Awaited<ReturnType<Transport["listTools"]>>;
    },
    async callTool(name, args, signal) {
      await assertSession?.();
      const result = await invokeAmazonMcp(identity, name, args, undefined, signal);
      await assertSession?.();
      return result as never;
    },
  } };
}

export async function runtimeToolsForUser(user: { id: string; organizationId: string }, request: Request, body: Record<string, unknown> = {}) {
  const { workspaceId } = workspaceScopeFromRequest(request, body);
  if (!await assertWorkspaceAccess(user.organizationId, workspaceId)) throw new Error("RESEARCH_SCOPE_DENIED");
  const scope = { organizationId: user.organizationId, userId: user.id, workspaceId };
  const settingsScope = { workspaceId, accountId: "", marketplace: "" };
  const assertMarketAccess = async () => {
    const verified = researchRequestAuthorization(request);
    if (verified && !(await verified.authorize("agents", "edit", request)).ok) throw new Error("RESEARCH_SCOPE_DENIED");
    await assertAmazonAction(scope, user.id, "edit", prisma, "agents");
  };
  // Configuration failures are isolated per source; secrets remain inside server adapters.
  const providers: RuntimeProvider[] = [];
  let erpCredentialId: string | undefined;
  const erpCredentialOptions: Array<{ id: string; name: string }> = [];
  try {
    const erp = await createErpResearchTransport(scope, undefined, async () => {
      const current = await getCurrentUserFromRequest(request);
      if (!current || current.id !== scope.userId || current.organizationId !== scope.organizationId || !await assertWorkspaceAccess(scope.organizationId, scope.workspaceId)) throw new SyncInputError("ERP 登录会话已失效，请重新登录。", 401);
    });
    erpCredentialId = erp.credentialId;
    providers.push({ id: "erp", ...erp, isReadOnly: tool => tool.annotations?.readOnlyHint === true });
  } catch { providers.push({ id: "erp", reason: "ERP_MCP_CONFIGURATION_UNAVAILABLE", isReadOnly: () => false }); }
  try {
    const settings = await getSellerSpriteMcpSettings(user, settingsScope);
    const live = liveMarketTransport(async () => {
      await assertMarketAccess();
      const current = await getSellerSpriteMcpSettings(user, settingsScope);
      if (!current.enabled || !current.apiKey || !current.serverUrl) return undefined;
      return {
        async listTools(signal) { return await listSellerSpriteRemoteTools(current, signal) as never; },
        async callTool(name, args, signal, schema) { return await callSellerSpriteRemoteTool(current, name, args, signal, schema) as never; },
      };
    });
    providers.push({ id: "sellersprite", isReadOnly: tool => tool.annotations?.readOnlyHint !== false && Boolean(sellerSpritePolicy(tool)),
      ...(settings.enabled && settings.apiKey ? { transport: live } : { reason: "SELLERSPRITE_MCP_NOT_CONFIGURED" }) });
  } catch { providers.push({ id: "sellersprite", reason: "SELLERSPRITE_CONFIGURATION_UNAVAILABLE", isReadOnly: () => false }); }
  try {
    const settings = await toolConfigStore.read(scope);
    providers.push({ id: "xiyou", isReadOnly: tool => tool.annotations?.readOnlyHint !== false && xiyouResearchReadTools.has(tool.name),
      ...(settings.enabled && settings.mcpToken ? { transport: liveMarketTransport(async () => {
        await assertMarketAccess();
        const current = await toolConfigStore.read(scope);
        if (!current.enabled || !current.mcpToken) return undefined;
        return createLiliTransport({ endpoint: current.mcpUrl, authorization: "Bearer " + current.mcpToken });
      }) } : { reason: "XIYOU_MCP_NOT_CONFIGURED" }) });
  } catch { providers.push({ id: "xiyou", reason: "XIYOU_CONFIGURATION_UNAVAILABLE", isReadOnly: () => false }); }
  return { ...createRuntimeTools(providers), erpCredentialId, erpCredentialOptions };
}
