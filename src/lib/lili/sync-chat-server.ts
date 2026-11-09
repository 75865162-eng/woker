import { prisma } from "@/lib/db/prisma";
import { authenticateAmazonMcp } from "@/lib/amazon-sync/mcp";
import { assertAmazonAction, explicitAmazonDataAccess, parseAccessScopes } from "@/lib/amazon-sync/data-access";
import { approvalSelect, applyChange, decideChange } from "@/lib/amazon-sync/change-approval";
import { executeSyncChat, syncSourcesWithinScope, type SyncChatPreview } from "./sync-chat-tools";
import type { ObjectJson } from "@/lib/selection-research/types";

export async function callSyncChatTool(request: Request, name: string, args: ObjectJson) {
  // Reauthenticate before every inspect, approval and apply, retaining the original credential identity.
  const initial = await authenticateAmazonMcp(request.headers.get("authorization"), new URL("/api/lili/mcp", process.env.LILI_PUBLIC_ORIGIN || request.url).href);
  const scope = { organizationId: initial.organizationId, workspaceId: initial.workspaceId };
  const inspect = async (): Promise<SyncChatPreview> => {
    const current = await authenticateAmazonMcp(request.headers.get("authorization"), new URL("/api/lili/mcp", process.env.LILI_PUBLIC_ORIGIN || request.url).href);
    if (current.id !== initial.id || current.revision !== initial.revision || !current.tools.includes(name) || !current.tools.includes("data_sync_start") || args.workspaceId !== current.workspaceId) throw new Error("WORKFLOW_ACCESS_DENIED");
    await assertAmazonAction(scope, current.userId, "view", prisma, "operations");
    if (name === "workflow_sync_confirm") await assertAmazonAction(scope, current.userId, "approve", prisma, "operations");
    const row = await prisma.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id: String(args.requestId), requestedByUserId: current.userId, operation: "run" }, select: approvalSelect });
    if (!row || !row.sourceIds.length) throw new Error("WORKFLOW_REQUEST_NOT_FOUND");
    const access = await explicitAmazonDataAccess(scope, current.userId, prisma, "sync", true);
    const credentialScopes = parseAccessScopes(current.scopes);
    const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, id: { in: row.sourceIds } }, select: { id: true, sellerAccountId: true, marketplaceId: true } });
    if (!syncSourcesWithinScope(sources, row.sourceIds, credentialScopes, access.scopes ?? [])) throw new Error("WORKFLOW_ACCESS_DENIED");
    return row as unknown as SyncChatPreview;
  };
  return executeSyncChat(name, args, {
    inspect,
    async approve(quote) {
      await inspect();
      return await decideChange(scope, initial.userId, String(args.requestId), "APPROVED", "Codex chat: " + quote) as unknown as SyncChatPreview;
    },
    async apply() { await inspect(); return applyChange(scope, initial.userId, String(args.requestId)); },
  });
}
