import { centerCompatibilityReadiness } from "@/lib/amazon-sync/compatibility";
import type { WorkspaceScopeInput } from "@/lib/workspace/scope";
import { getAmazonSpApiConfigurationStatus } from "@/lib/amazon/sp-api-config";
import { amazonReadDomains, type AmazonMarketplaceParticipation, type AmazonReadDomain, type AmazonSyncResource, type DomainFreshnessSummary, type OperationsConnection, type OperationsInventorySnapshotSummary, type OperationsReadiness, type OperationsSyncRun } from "./types";

const amazonProvider = "amazon_sp_api";

function isAmazonReadDomain(value: unknown): value is AmazonReadDomain {
  return typeof value === "string" && (amazonReadDomains as readonly string[]).includes(value);
}

function toConnection(row?: {
  id: string;
  status: string;
  enabledDomains: unknown;
  marketplaceParticipations: unknown;
  statusMessage: string | null;
  lastValidatedAt: Date | null;
  lastSyncAt: Date | null;
} | null, runtimeConfiguration = getAmazonSpApiConfigurationStatus()): OperationsConnection {
  const enabledDomains = Array.isArray(row?.enabledDomains) ? row.enabledDomains.filter(isAmazonReadDomain) : [];
  const marketplaceParticipations = parseMarketplaceParticipations(row?.marketplaceParticipations);
  const status = row?.status === "CONFIGURED" || row?.status === "DISABLED" || row?.status === "ERROR"
    ? row.status
    : "NOT_CONFIGURED";

  return {
    id: row?.id ?? null,
    provider: amazonProvider,
    status,
    enabledDomains,
    marketplaceParticipations,
    statusMessage: row?.statusMessage?.trim() || (runtimeConfiguration.configured ? "服务端 SP-API 授权配置已就绪，等待连接验证。" : "等待配置 Amazon SP-API 授权。"),
    lastValidatedAt: row?.lastValidatedAt?.toISOString() ?? null,
    lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
    runtimeConfiguration,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildBlockedAmazonSyncRun(input: {
  id: string;
  resource: AmazonSyncResource;
  now: Date;
  reason?: string;
  idempotencyKey?: string;
}): OperationsSyncRun {
  const error = input.reason ?? "Amazon SP-API 尚未配置，未向 Amazon 发起同步请求。";

  return {
    id: input.id,
    resource: input.resource,
    idempotencyKey: input.idempotencyKey ?? null,
    status: "BLOCKED",
    summary: { externalRequestAttempted: false, provider: amazonProvider },
    error,
    startedAt: input.now.toISOString(),
    finishedAt: input.now.toISOString(),
  };
}

export async function getOperationsReadiness(input: {
  actorUserId?: string;
  organizationId: string;
  scope: WorkspaceScopeInput;
}): Promise<OperationsReadiness> {
  if (process.env.DATABASE_URL) return centerCompatibilityReadiness({ organizationId: input.organizationId, workspaceId: input.scope.workspaceId }, input.scope, input.actorUserId);
  const inventory = emptyInventorySummary();
  return { scope: input.scope, generatedAt: new Date().toISOString(), connection: toConnection(null, { configured: false, missingEnvironmentVariables: [], region: "按授权路由" }), runs: [], inventory, domains: emptyDomainFreshnessSummaries(inventory) };
}

function emptyInventorySummary(): OperationsInventorySnapshotSummary {
  return {
    status: "NOT_SYNCED",
    syncRunId: null,
    capturedAt: null,
    snapshotCount: 0,
    fulfillableQuantity: 0,
    inboundQuantity: 0,
    reservedQuantity: 0,
    unfulfillableQuantity: 0,
  };
}

export function emptyDomainFreshnessSummaries(inventory: OperationsInventorySnapshotSummary): Record<AmazonReadDomain, DomainFreshnessSummary> {
  return Object.fromEntries(amazonReadDomains.map((resource) => [resource, {
    resource,
    status: resource === "inventory" ? inventory.status : "NOT_SYNCED",
    source: null,
    syncRunId: inventory.syncRunId && resource === "inventory" ? inventory.syncRunId : null,
    lastSuccessAt: inventory.capturedAt && resource === "inventory" ? inventory.capturedAt : null,
    lastAttemptAt: null,
    lastAttemptStatus: null,
    lastAttemptError: null,
    reason: resource === "inventory"
      ? inventory.status === "NOT_SYNCED" ? "当前工作区尚无成功的库存快照。" : inventory.status === "STALE" ? "最近一次库存快照已超过新鲜度阈值。" : null
      : resource === "ads" ? "PPC 日粒度 SKU/ASIN 投影未接通。" : resource === "catalog" ? "刊登同步执行器已就绪，等待店铺身份及授权绑定。" : "该数据域尚未接入 Amazon 同步执行器。",
    recommendedAction: resource === "inventory"
      ? inventory.status === "FRESH" ? null : "检查 Amazon 连接与 Worker 后重新请求库存同步。"
      : resource === "ads" ? "在现有 PPC 工作台查看广告指标；本页不另建广告同步。" : "无需重试；该数据域尚未开放同步。",
  }])) as Record<AmazonReadDomain, DomainFreshnessSummary>;
}

export function buildDomainFreshnessSummaries(input: {
  inventory: OperationsInventorySnapshotSummary;
  latestByDomain: Map<AmazonReadDomain, DomainRunState>;
}): Record<AmazonReadDomain, DomainFreshnessSummary> {
  const summaries = emptyDomainFreshnessSummaries(input.inventory);
  summaries.inventory = {
    ...summaries.inventory,
    source: "Amazon SP-API FBA Inventory Summaries",
    lastAttemptAt: input.latestByDomain.get("inventory")?.latestAttempt?.startedAt.toISOString() ?? null,
    lastAttemptStatus: input.latestByDomain.get("inventory")?.latestAttempt ? syncRunStatus(input.latestByDomain.get("inventory")!.latestAttempt!.status) : null,
    lastAttemptError: input.latestByDomain.get("inventory")?.latestAttempt?.error ?? null,
  };

  for (const resource of amazonReadDomains) {
    if (resource === "ads" || resource === "inventory") continue;
    const state = input.latestByDomain.get(resource);
    const latest = state?.latestAttempt;
    const success = state?.latestSuccess;
    if (resource === "catalog" && success?.finishedAt) {
      const failed = latest && (latest.status === "FAILED" || latest.status === "BLOCKED") && latest.startedAt >= success.finishedAt;
      const stale = Date.now() - success.finishedAt.getTime() > 48 * 60 * 60_000;
      summaries.catalog = { ...summaries.catalog, status: failed ? latest!.status as "FAILED" | "BLOCKED" : stale ? "STALE" : "FRESH", source: "Amazon Listings Items API", syncRunId: success.id, lastSuccessAt: success.finishedAt.toISOString(), lastAttemptAt: latest?.startedAt.toISOString() ?? null, lastAttemptStatus: latest ? syncRunStatus(latest.status) : null, lastAttemptError: latest?.error ?? null, reason: failed ? latest?.error ?? "刊登同步失败" : stale ? "刊登快照已超过 48 小时。" : null, recommendedAction: failed || stale ? "检查店铺绑定/API 授权和 worker 后同步在线产品。" : null };
      continue;
    }
    const attemptStatus = latest ? syncRunStatus(latest.status) : null;
    const newerFailure = latest && (latest.status === "FAILED" || latest.status === "BLOCKED");
    const status = newerFailure ? latest.status as "FAILED" | "BLOCKED" : "NOT_SYNCED";
    summaries[resource] = {
      resource,
      status,
      source: null,
      syncRunId: latest?.id ?? null,
      lastSuccessAt: null,
      lastAttemptAt: latest?.startedAt.toISOString() ?? null,
      lastAttemptStatus: attemptStatus,
      lastAttemptError: latest?.error ?? null,
      reason: newerFailure ? latest?.error ?? "最近一次同步失败。" : resource === "catalog" ? "刊登执行器已就绪，等待店铺身份/授权绑定与首次同步。" : "该数据域尚未接入 Amazon 同步执行器。",
      recommendedAction: newerFailure ? "查看同步历史中的失败原因，再由系统管理员处理。" : resource === "catalog" ? "配置已授权的 Seller ID、店铺和站点后启用刊登计划。" : "无需重试；该数据域尚未开放同步。",
    };
  }

  if (input.inventory.status === "STALE") {
    summaries.inventory.reason = "库存快照已超过配置的新鲜度阈值。";
    summaries.inventory.recommendedAction = "检查 Amazon 连接与 Worker 后重新请求库存同步。";
  } else if (input.inventory.status === "NOT_SYNCED") {
    summaries.inventory.reason = "当前工作区尚无成功的库存快照。";
    summaries.inventory.recommendedAction = "检查 Amazon 连接与 Worker 后请求库存同步。";
  } else {
    summaries.inventory.reason = null;
    summaries.inventory.recommendedAction = null;
  }

  return summaries;
}

type DomainRunState = {
  latestAttempt: { id: string; status: string; error: string | null; startedAt: Date; finishedAt: Date | null } | null;
  latestSuccess: { id: string; status: string; error: string | null; startedAt: Date; finishedAt: Date | null } | null;
};

function syncRunStatus(value: string): OperationsSyncRun["status"] {
  return value === "QUEUED" || value === "RUNNING" || value === "SUCCEEDED" || value === "FAILED" ? value : "BLOCKED";
}

export function inventorySnapshotStatus(capturedAt: Date | null, now = new Date(), freshnessMinutes = configuredInventoryFreshnessMinutes()): OperationsInventorySnapshotSummary["status"] {
  if (!capturedAt) return "NOT_SYNCED";
  return now.getTime() - capturedAt.getTime() <= freshnessMinutes * 60_000 ? "FRESH" : "STALE";
}

function configuredInventoryFreshnessMinutes() {
  const value = Number(process.env.AMAZON_INVENTORY_FRESHNESS_MINUTES ?? 360);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 15), 24 * 60) : 360;
}

export async function requestAmazonSync(...args: unknown[]): Promise<never> { void args; throw new Error("旧同步入口已退役，请创建执行审批。"); }
export async function validateAmazonConnection(...args: unknown[]): Promise<never> { void args; throw new Error("旧验证入口已退役，请创建执行审批。"); }

export function extractMarketplaceParticipations(value: unknown): AmazonMarketplaceParticipation[] {
  if (!isRecord(value) || !Array.isArray(value.payload)) return [];
  const seen = new Set<string>();
  const participations: AmazonMarketplaceParticipation[] = [];
  for (const item of value.payload) {
    if (!isRecord(item)) continue;
    const participation = isRecord(item.participation) ? item.participation : item;
    if (participation.isParticipating === false) continue;
    const marketplace = isRecord(item.marketplace) ? item.marketplace : item;
    const marketplaceId = stringValue(marketplace.id ?? marketplace.marketplaceId);
    if (!marketplaceId || seen.has(marketplaceId)) continue;
    seen.add(marketplaceId);
    participations.push({
      ...(typeof participation.isParticipating === "boolean" ? { isParticipating: participation.isParticipating } : {}),
      marketplaceId,
      countryCode: stringValue(marketplace.countryCode).toUpperCase(),
      name: stringValue(marketplace.name),
      domainName: stringValue(marketplace.domainName),
    });
  }
  return participations.slice(0, 100);
}

function parseMarketplaceParticipations(value: unknown): AmazonMarketplaceParticipation[] {
  return extractMarketplaceParticipations({ payload: value });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

export function normalizeSyncIdempotencyKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new Error("幂等键只能包含字母、数字、点、下划线、冒号或连字符，且长度不超过 160。" );
  }
  return normalized;
}
