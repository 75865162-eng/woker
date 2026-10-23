import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import type { WorkspaceScopeInput } from "@/lib/workspace/scope";
import { AmazonSpApiClient, AmazonSpApiError } from "@/lib/amazon/sp-api-client";
import { assertAmazonSpApiScopeAllowed, getAmazonSpApiConfigurationStatus, getAmazonSpApiServerConfiguration } from "@/lib/amazon/sp-api-config";
import { enqueueAmazonSyncRun } from "@/lib/queue";
import { amazonReadDomains, type AmazonMarketplaceParticipation, type AmazonReadDomain, type AmazonSyncResource, type DomainFreshnessSummary, type OperationsConnection, type OperationsInventorySnapshotSummary, type OperationsReadiness, type OperationsSyncRun } from "./types";
import { getSyncSchedules } from "./schedules";

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
} | null): OperationsConnection {
  const runtimeConfiguration = getAmazonSpApiConfigurationStatus();
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

function toSyncRun(row: {
  id: string;
  resource: string;
  idempotencyKey: string | null;
  status: string;
  summary: unknown;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}): OperationsSyncRun {
  return {
    id: row.id,
    resource: row.resource === "readiness" || isAmazonReadDomain(row.resource) ? row.resource : "readiness",
    idempotencyKey: row.idempotencyKey,
    status: row.status === "QUEUED" || row.status === "RUNNING" || row.status === "SUCCEEDED" || row.status === "FAILED" ? row.status : "BLOCKED",
    summary: isRecord(row.summary) ? row.summary : null,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
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
  organizationId: string;
  scope: WorkspaceScopeInput;
}): Promise<OperationsReadiness> {
  const generatedAt = new Date();
  const base = {
    scope: input.scope,
    generatedAt: generatedAt.toISOString(),
  };

  if (!process.env.DATABASE_URL) {
    const inventory = emptyInventorySummary();
    return { ...base, connection: toConnection(), runs: [], inventory, domains: emptyDomainFreshnessSummaries(inventory) };
  }

  const where = { organizationId: input.organizationId, workspaceId: input.scope.workspaceId };
  const [connection, runs, latestInventoryRun, domainRuns, schedules] = await Promise.all([
    prisma.amazonIntegrationConnection.findUnique({
      where: { organizationId_workspaceId_provider: { ...where, provider: amazonProvider } },
    }),
    prisma.amazonSyncRun.findMany({ where, orderBy: { startedAt: "desc" }, take: 20 }),
    prisma.amazonSyncRun.findFirst({ where: { ...where, resource: "inventory", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } }),
    Promise.all(amazonReadDomains.filter((resource) => resource !== "ads").map(async (resource) => {
      const latestAttempt = await prisma.amazonSyncRun.findFirst({ where: { ...where, resource }, orderBy: { startedAt: "desc" } });
      const latestSuccess = resource === "catalog" ? await prisma.amazonSyncRun.findFirst({ where: { ...where, resource, status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } }) : null;
      return [resource, { latestAttempt, latestSuccess }] as const;
    })),
    getSyncSchedules(input.organizationId, input.scope.workspaceId),
  ]);
  const inventory = latestInventoryRun
    ? await getInventorySummary(latestInventoryRun.id, input.organizationId, input.scope.workspaceId, generatedAt)
    : emptyInventorySummary();
  const latestByDomain = new Map(domainRuns);
  const domains = buildDomainFreshnessSummaries({ inventory, latestByDomain });
  for (const schedule of schedules) domains[schedule.resource].nextScheduledAt = schedule.nextScheduledAt;
  const latest = latestByDomain.get("inventory")?.latestAttempt;
  if (latest?.status === "RUNNING" || latest?.status === "QUEUED") domains.inventory.status = "SYNCING";
  else if (latest?.status === "FAILED" || latest?.status === "BLOCKED") domains.inventory.status = latest.status;
  const catalogAttempt = latestByDomain.get("catalog")?.latestAttempt;
  if (catalogAttempt?.status === "RUNNING" || catalogAttempt?.status === "QUEUED") domains.catalog.status = "SYNCING";
  if (connection?.status === "DISABLED") { domains.inventory.status = "DISABLED"; domains.catalog.status = "DISABLED"; }

  return {
    ...base,
    connection: toConnection(connection),
    runs: runs.map(toSyncRun),
    inventory,
    domains,
  };
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

async function getInventorySummary(syncRunId: string, organizationId: string, workspaceId: string, now: Date): Promise<OperationsInventorySnapshotSummary> {
  const result = await prisma.amazonInventorySnapshot.aggregate({
    where: { syncRunId, organizationId, workspaceId },
    _count: { _all: true },
    _max: { capturedAt: true },
    _sum: {
      fulfillableQuantity: true,
      inboundWorkingQuantity: true,
      inboundShippedQuantity: true,
      inboundReceivingQuantity: true,
      reservedQuantity: true,
      unfulfillableQuantity: true,
    },
  });
  const sum = result._sum;
  return {
    status: inventorySnapshotStatus(result._max.capturedAt, now),
    syncRunId,
    capturedAt: result._max.capturedAt?.toISOString() ?? null,
    snapshotCount: result._count._all,
    fulfillableQuantity: sum.fulfillableQuantity ?? 0,
    inboundQuantity: (sum.inboundWorkingQuantity ?? 0) + (sum.inboundShippedQuantity ?? 0) + (sum.inboundReceivingQuantity ?? 0),
    reservedQuantity: sum.reservedQuantity ?? 0,
    unfulfillableQuantity: sum.unfulfillableQuantity ?? 0,
  };
}

type DomainRunState = {
  latestAttempt: {
    id: string;
    status: string;
    error: string | null;
    startedAt: Date;
    finishedAt: Date | null;
  } | null;
  latestSuccess?: { id: string; finishedAt: Date | null } | null;
};

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

export async function requestAmazonSync(input: {
  user: CurrentUser;
  scope: WorkspaceScopeInput;
  resource: AmazonSyncResource;
  idempotencyKey?: string;
}): Promise<OperationsSyncRun> {
  const now = new Date();
  const id = `amazon-sync-${randomUUID()}`;
  const idempotencyKey = normalizeSyncIdempotencyKey(input.idempotencyKey);
  const blocked = buildBlockedAmazonSyncRun({ id, resource: input.resource, now, idempotencyKey });

  if (!process.env.DATABASE_URL) {
    return blocked;
  }

  if (idempotencyKey) {
    const existing = await prisma.amazonSyncRun.findUnique({
      where: {
        organizationId_workspaceId_idempotencyKey: {
          organizationId: input.user.organizationId,
          workspaceId: input.scope.workspaceId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.resource !== input.resource) {
        throw new Error("该幂等键已用于其他同步数据域。");
      }
      return toSyncRun(existing);
    }
  }

  const connection = await prisma.amazonIntegrationConnection.findUnique({
    where: {
      organizationId_workspaceId_provider: {
        organizationId: input.user.organizationId,
        workspaceId: input.scope.workspaceId,
        provider: amazonProvider,
      },
    },
  });

  if (connection?.status === "CONFIGURED" && (input.resource === "inventory" || input.resource === "catalog") && process.env.QUEUE_DRIVER === "redis") {
    try {
      assertAmazonSpApiScopeAllowed({ organizationId: input.user.organizationId, workspaceId: input.scope.workspaceId });
    } catch (error) {
      return await createBlockedRun({
        ...input,
        id,
        now,
        idempotencyKey,
        reason: error instanceof Error ? error.message : "当前作用域未获准使用 Amazon 连接。",
      });
    }
    return createQueuedRun({ ...input, resource: input.resource, id, now, idempotencyKey });
  }
  if (connection?.status === "CONFIGURED" && (input.resource === "inventory" || input.resource === "catalog")) {
    return await createBlockedRun({ ...input, id, now, idempotencyKey, reason: "Amazon 商品/库存同步需要 Redis Worker。当前未启用 QUEUE_DRIVER=redis，未向 Amazon 发起同步请求。" });
  }
  if (connection?.status === "CONFIGURED") {
    return await createBlockedRun({ ...input, id, now, idempotencyKey, reason: "所选 Amazon 同步执行器尚未启用，未向 Amazon 发起同步请求。" });
  }

  return await createBlockedRun({ ...input, id, now, idempotencyKey, reason: blocked.error ?? undefined });
}

async function createQueuedRun(input: {
  user: CurrentUser;
  scope: WorkspaceScopeInput;
  resource: "inventory" | "catalog";
  id: string;
  now: Date;
  idempotencyKey?: string;
}): Promise<OperationsSyncRun> {
  const row = await prisma.$transaction(async (tx) => {
    const key = JSON.stringify(["enqueue", input.user.organizationId, input.scope.workspaceId, input.resource]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    if (input.idempotencyKey) {
      const prior = await tx.amazonSyncRun.findUnique({ where: { organizationId_workspaceId_idempotencyKey: {
        organizationId: input.user.organizationId, workspaceId: input.scope.workspaceId, idempotencyKey: input.idempotencyKey,
      } } });
      if (prior) {
        if (prior.resource !== input.resource) throw new Error("该幂等键已用于其他同步数据域。");
        return prior;
      }
    }
    const active = await tx.amazonSyncRun.findFirst({ where: {
      organizationId: input.user.organizationId, workspaceId: input.scope.workspaceId,
      resource: input.resource, status: { in: ["QUEUED", "RUNNING"] },
    } });
    if (active) return active;
    return tx.amazonSyncRun.create({
    data: {
      id: input.id,
      organizationId: input.user.organizationId,
      workspaceId: input.scope.workspaceId,
      requestedByUserId: input.user.id,
      resource: input.resource,
      idempotencyKey: input.idempotencyKey,
      status: "QUEUED",
      summary: { provider: amazonProvider, externalRequestAttempted: false, queue: "amazon-sync-jobs" },
      startedAt: input.now,
    },
    });
  });
  if (row.status !== "QUEUED") return toSyncRun(row);
  try {
    await enqueueAmazonSyncRun(row.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Amazon 同步任务入队失败。";
    const blocked = await prisma.amazonSyncRun.update({ where: { id: row.id }, data: { status: "BLOCKED", error: message, finishedAt: new Date() } });
    return toSyncRun(blocked);
  }
  return toSyncRun(row);
}

export async function validateAmazonConnection(input: {
  user: CurrentUser;
  scope: WorkspaceScopeInput;
}): Promise<{ connection: OperationsConnection; run: OperationsSyncRun }> {
  const configuration = getAmazonSpApiConfigurationStatus();
  if (!configuration.configured) {
    throw new Error(`服务端缺少 SP-API 配置：${configuration.missingEnvironmentVariables.join("、")}`);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("数据库未配置，无法记录服务端配置验证结果。");
  }

  assertAmazonSpApiScopeAllowed({ organizationId: input.user.organizationId, workspaceId: input.scope.workspaceId });
  const serverConfiguration = getAmazonSpApiServerConfiguration();

  const now = new Date();
  const connectionId = `amazon-connection-${input.user.organizationId}-${input.scope.workspaceId}-${amazonProvider}`;
  const runId = `amazon-sync-${randomUUID()}`;
  const scope = { organizationId: input.user.organizationId, workspaceId: input.scope.workspaceId, provider: amazonProvider };
  try {
    const response = await new AmazonSpApiClient(serverConfiguration).getMarketplaceParticipations();
    const marketplaceParticipations = extractMarketplaceParticipations(response);
    const marketplaceCount = marketplaceParticipations.length;
    const [connection, run] = await prisma.$transaction([
      prisma.amazonIntegrationConnection.upsert({
        where: { organizationId_workspaceId_provider: scope },
        create: {
          id: connectionId,
          ...scope,
          status: "CONFIGURED",
          enabledDomains: [],
          marketplaceParticipations,
          statusMessage: `Amazon 连接已验证；发现 ${marketplaceCount} 个可访问站点。数据同步尚未启用。`,
          lastValidatedAt: now,
        },
        update: {
          status: "CONFIGURED",
          marketplaceParticipations,
          statusMessage: `Amazon 连接已验证；发现 ${marketplaceCount} 个可访问站点。数据同步尚未启用。`,
          lastValidatedAt: now,
        },
      }),
      prisma.amazonSyncRun.create({
        data: {
          id: runId,
          organizationId: input.user.organizationId,
          workspaceId: input.scope.workspaceId,
          requestedByUserId: input.user.id,
          resource: "readiness",
          status: "SUCCEEDED",
          summary: {
            kind: "connection_validation",
            externalRequestAttempted: true,
            provider: amazonProvider,
            region: configuration.region,
            endpointHost: new URL(serverConfiguration.endpoint).host,
            marketplaceCount,
          },
          startedAt: now,
          finishedAt: new Date(),
        },
      }),
    ]);
    return { connection: toConnection(connection), run: toSyncRun(run) };
  } catch (error) {
    const message = error instanceof AmazonSpApiError ? error.message : "Amazon SP-API 连接校验失败。";
    const [connection, run] = await prisma.$transaction([
      prisma.amazonIntegrationConnection.upsert({
        where: { organizationId_workspaceId_provider: scope },
        create: {
          id: connectionId,
          ...scope,
          status: "ERROR",
          enabledDomains: [],
          marketplaceParticipations: [],
          statusMessage: message,
          lastValidatedAt: now,
        },
        update: { status: "ERROR", statusMessage: message, lastValidatedAt: now },
      }),
      prisma.amazonSyncRun.create({
        data: {
          id: runId,
          organizationId: input.user.organizationId,
          workspaceId: input.scope.workspaceId,
          requestedByUserId: input.user.id,
          resource: "readiness",
          status: "FAILED",
          summary: { kind: "connection_validation", externalRequestAttempted: true, provider: amazonProvider },
          error: message,
          startedAt: now,
          finishedAt: new Date(),
        },
      }),
    ]);
    return { connection: toConnection(connection), run: toSyncRun(run) };
  }
}

export function extractMarketplaceParticipations(value: unknown): AmazonMarketplaceParticipation[] {
  if (!isRecord(value) || !Array.isArray(value.payload)) return [];
  const seen = new Set<string>();
  const participations: AmazonMarketplaceParticipation[] = [];
  for (const item of value.payload) {
    if (!isRecord(item)) continue;
    const marketplace = isRecord(item.marketplace) ? item.marketplace : item;
    const marketplaceId = stringValue(marketplace.id ?? marketplace.marketplaceId);
    if (!marketplaceId || seen.has(marketplaceId)) continue;
    seen.add(marketplaceId);
    participations.push({
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

async function createBlockedRun(input: {
  user: CurrentUser;
  scope: WorkspaceScopeInput;
  resource: AmazonSyncResource;
  id: string;
  now: Date;
  idempotencyKey?: string;
  reason?: string;
}): Promise<OperationsSyncRun> {
  const run = buildBlockedAmazonSyncRun({ id: input.id, resource: input.resource, now: input.now, reason: input.reason, idempotencyKey: input.idempotencyKey });
  await prisma.amazonSyncRun.create({
    data: {
      id: run.id,
      organizationId: input.user.organizationId,
      workspaceId: input.scope.workspaceId,
      requestedByUserId: input.user.id,
      resource: run.resource,
      idempotencyKey: run.idempotencyKey,
      status: run.status,
      summary: run.summary as Prisma.InputJsonValue,
      error: run.error,
      startedAt: input.now,
      finishedAt: input.now,
    },
  });

  return run;
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
