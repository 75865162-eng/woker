import { prisma } from "@/lib/db/prisma";
import type { OperationsReadiness } from "@/lib/operations/types";
import { emptyDomainFreshnessSummaries } from "@/lib/operations/readiness";
import { listSources, inventoryPublishedWhere, oldestSnapshot, publishedSnapshotScopes } from "./read";
import type { SyncScope } from "./policy";
import type { WorkspaceScopeInput } from "@/lib/workspace/scope";
import { amazonAccountReadAccess } from "./read-account";

/** Legacy consumers get aggregate freshness from the same published heads as the center. */
export async function centerCompatibilityReadiness(scope: SyncScope, workspace: WorkspaceScopeInput, actor?: string, params = new URLSearchParams()): Promise<OperationsReadiness> {
  const access = await amazonAccountReadAccess(scope, actor, params);
  const target = { sellerAccountId: access.sellerIds[0], ...(params.get("marketplaceId") ? { marketplaceId: params.get("marketplaceId")! } : {}) };
  const sources = await listSources(scope, target, actor), heads = await publishedSnapshotScopes(scope, "inventory", actor, target);
  const totals = heads.length ? await prisma.amazonInventorySnapshot.aggregate({ where: inventoryPublishedWhere(scope, heads), _sum: { fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true, reservedQuantity: true, unfulfillableQuantity: true } }) : null;
  const inventorySources = sources.filter(s => s.resource === "inventory" && s.enabled), capturedAt = oldestSnapshot(heads);
  const inventory = { status: !inventorySources.length || inventorySources.some(s => !s.activeRunId) ? "NOT_SYNCED" as const : inventorySources.some(s => !s.lastSuccessAt || Date.now() - s.lastSuccessAt.getTime() > s.freshnessMinutes * 60000) ? "STALE" as const : "FRESH" as const,
    syncRunId: heads.length === 1 ? heads[0].runId : null, capturedAt: capturedAt?.toISOString() ?? null, snapshotCount: inventorySources.reduce((a, s) => a + s.rowCount, 0), fulfillableQuantity: totals?._sum.fulfillableQuantity ?? 0, inboundQuantity: (totals?._sum.inboundWorkingQuantity ?? 0) + (totals?._sum.inboundShippedQuantity ?? 0) + (totals?._sum.inboundReceivingQuantity ?? 0), reservedQuantity: totals?._sum.reservedQuantity ?? 0, unfulfillableQuantity: totals?._sum.unfulfillableQuantity ?? 0 };
  const domains = emptyDomainFreshnessSummaries(inventory);
  for (const resource of ["inventory", "catalog"] as const) {
    const group = sources.filter(s => s.resource === resource && s.enabled);
    const times = group.map(s => s.lastSuccessAt).filter((v): v is Date => !!v);
    const failed = group.find(s => ["FAILED", "BLOCKED"].includes(s.health));
    domains[resource] = { ...domains[resource], source: resource === "inventory" ? "Amazon SP-API FBA Inventory Summaries" : "Amazon Listings Items API", status: failed ? failed.health as "FAILED" | "BLOCKED" : group.some(s => s.health === "SYNCING") ? "SYNCING" : !group.length || group.some(s => !s.activeRunId) ? "NOT_SYNCED" : group.some(s => s.health === "STALE") ? "STALE" : "FRESH", lastSuccessAt: times.length === group.length && times.length ? new Date(Math.min(...times.map(t => t.getTime()))).toISOString() : null, reason: failed?.latestTask?.error ?? null, recommendedAction: failed ? "在同步中心按店铺和站点检查任务。" : null };
  }
  const configured = sources.length > 0 && sources.every(s => s.authorization.status === "CONFIGURED");
  const liveParams = new URLSearchParams(params); liveParams.set("sellerAccountId", target.sellerAccountId);
  await amazonAccountReadAccess(scope, actor, liveParams);
  return { scope: workspace, generatedAt: new Date().toISOString(), inventory, domains, runs: [], connection: { id: null, provider: "amazon_sp_api", status: configured ? "CONFIGURED" : "NOT_CONFIGURED", enabledDomains: sources.filter(s => s.enabled).map(s => s.resource).filter((v): v is "inventory" | "catalog" => v === "inventory" || v === "catalog"), marketplaceParticipations: [], statusMessage: "已切换多授权同步中心；请在中心查看逐店铺、站点状态。", lastValidatedAt: null, lastSyncAt: null, runtimeConfiguration: { configured, missingEnvironmentVariables: [], region: "按授权路由" } } };
}
