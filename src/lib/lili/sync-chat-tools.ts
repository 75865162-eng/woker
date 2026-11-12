import type { ObjectJson, ToolDefinition } from "@/lib/selection-research/types";
import { rejectCredentials, validate } from "@/lib/selection-research/schema";
import { skillSyncRetryResources } from "@/lib/amazon-sync/skill-sync-retry";
export const syncChatTools: ToolDefinition[] = [
  { name: "workflow_sync_review", description: "Preview one owned ERP data_sync_start request in the current credential's seller/workspace scope. Returns exact digest, revision, targets, effects and status. No dispatch. Present it in Codex chat before requesting one approval. Unsupported store writes are not accepted.", inputSchema: { type: "object", properties: { workspaceId: { type: "string", minLength: 1 }, requestId: { type: "string", minLength: 1, maxLength: 100 } }, required: ["workspaceId", "requestId"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "workflow_sync_confirm", description: "After the human explicitly approves the exact workflow_sync_review plan in Codex chat, record that quote, approve and apply that single bounded data sync request using existing services. No second browser approval. Requires expectedDigest and expectedRevision from the preview. Never invent human consent. If interrupted, read the request status before resuming; never recreate requests. Does not support configuration changes, access grants, arbitrary store writes or budget increases.", inputSchema: { type: "object", properties: { workspaceId: { type: "string", minLength: 1 }, requestId: { type: "string", minLength: 1, maxLength: 100 }, expectedDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, expectedRevision: { type: "integer", minimum: 0 }, userConfirmation: { type: "string", minLength: 1, maxLength: 2000 } }, required: ["workspaceId", "requestId", "expectedDigest", "expectedRevision", "userConfirmation"], additionalProperties: false }, annotations: { readOnlyHint: false } },
];
export type SyncChatPreview = { id: string; operation: string; requestedByUserId: string; changeDigest: string; baseRevision: number; status: string; expiresAt: Date | string } & Record<string, unknown>;
export type SyncChatDependencies = {
  inspect(): Promise<SyncChatPreview>;
  approve(quote: string): Promise<SyncChatPreview>;
  apply(): Promise<unknown>;
};
export function supportedSyncChatRequest(row: SyncChatPreview) {
  if (row.operation === "run") return true;
  const command = row.afterSummary as Record<string, unknown> | null;
  return row.operation === "control-task" && ["retry", "resume"].includes(String(command?.control)) && typeof row.targetId === "string" && !!row.targetId && command?.id === row.targetId
    && Array.isArray(row.domains) && row.domains.length === 1 && (skillSyncRetryResources as readonly unknown[]).includes(row.domains[0])
    && Array.isArray(row.sourceIds) && row.sourceIds.length === 1
    && Array.isArray(row.marketplaceIds) && row.marketplaceIds.length === 1;
}
/** Side effects remain in domain services. This orchestration is independently testable without credentials/DB. */
export async function executeSyncChat(name: string, args: ObjectJson, deps: SyncChatDependencies) {
  const tool = syncChatTools.find(tool => tool.name === name);
  if (!tool) throw new Error("UNKNOWN_WORKFLOW_TOOL");
  rejectCredentials(args); validate(tool.inputSchema, args);
  let row = await deps.inspect();
  if (!supportedSyncChatRequest(row)) throw new Error("WORKFLOW_EXECUTOR_UNSUPPORTED");
  if (name === "workflow_sync_review") return { ok: true, request: row, nextAction: { kind: row.status === "APPLIED" ? "DONE" : "CHAT_CONFIRM", channel: "codex_chat", browserRequired: false } };
  if (!String(args.userConfirmation).trim()) throw new Error("HUMAN_CONFIRMATION_REQUIRED");
  if (row.changeDigest !== args.expectedDigest || row.baseRevision !== args.expectedRevision) throw new Error("STALE_WORKFLOW_PLAN");
  if (row.status === "APPLIED") return { ok: true, alreadyApplied: true, request: row };
  if (new Date(row.expiresAt).getTime() <= Date.now()) throw new Error("WORKFLOW_PLAN_EXPIRED");
  if (row.status === "REQUESTED") row = await deps.approve(String(args.userConfirmation));
  // Approval services may return STALE/EXPIRED instead of throwing. Never apply those states.
  if (row.status !== "APPROVED") throw new Error("WORKFLOW_PLAN_NOT_APPROVED");
  if (!supportedSyncChatRequest(row) || row.changeDigest !== args.expectedDigest || row.baseRevision !== args.expectedRevision) throw new Error("STALE_WORKFLOW_PLAN");
  const result = await deps.apply();
  return { ok: true, result, nextAction: { kind: "CONTINUE", channel: "codex_chat", browserRequired: false } };
}

export function syncSourcesWithinScope(sources: { id: string; sellerAccountId: string; marketplaceId: string }[], sourceIds: string[], credentialScopes: readonly { sellerAccountId: string; marketplaceIds: readonly string[] }[], accessScopes: readonly { sellerAccountId: string; marketplaceIds: readonly string[] }[]) {
  return sourceIds.length > 0 && sources.length === sourceIds.length && new Set(sources.map(source => source.id)).size === sourceIds.length && sources.every(source => sourceIds.includes(source.id) && credentialScopes.some(scope => scope.sellerAccountId === source.sellerAccountId && scope.marketplaceIds.includes(source.marketplaceId)) && accessScopes.some(scope => scope.sellerAccountId === source.sellerAccountId && (!scope.marketplaceIds.length || scope.marketplaceIds.includes(source.marketplaceId))));
}
