import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * 同步分片与覆盖度记账层。
 *
 * - SellfoxSyncShard：一次 run 按「资源 × 店铺(scopeKey) × 期间(period)」记录写入行数与断点。
 *   分片是断点续跑与排障的依据；重跑覆盖同一分片时 upsert，不做历史累积。
 * - SellfoxCoverage：run 完成后按「资源 × 店铺」从事实表**重新计算**行数与日期区间，
 *   不是累加写入数——保证覆盖度永远等于落表数据，而不是记账 promise。
 *
 * 记账失败不允许拖垮同步：调用方（sync-service）负责 catch 并打日志。
 */

export type SellfoxShardDraft = {
  scopeKey: string;
  period: string;
  status: "done" | "failed" | "running";
  rows: number;
  cursor?: Record<string, unknown> | null;
};

export type SellfoxShardRequest = {
  organizationId: string;
  workspaceId: string;
  resource: string;
  runId: string;
};

type ProgressBag = Record<string, unknown>;

function asBag(value: unknown): ProgressBag | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ProgressBag : null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function rowsFromResult(result: unknown): number {
  const bag = asBag(result);
  if (!bag) return 0;
  for (const key of ["count", "synced", "writes", "rows"]) {
    if (bag[key] != null) return asNumber(bag[key]);
  }
  return 0;
}

function periodRange(request: { reportDate?: string; startDate?: string; endDate?: string }) {
  if (request.reportDate) return request.reportDate;
  if (request.startDate && request.endDate) return request.startDate === request.endDate ? request.startDate : `${request.startDate}..${request.endDate}`;
  return request.startDate ?? request.endDate ?? "latest";
}

/** 快照/利润检查点里的「店铺 → 行数」：SnapshotCheckpoint 与 PerformanceCheckpoint 两种形态。 */
function storeRowsFromCheckpoint(value: unknown): Map<string, number> | null {
  const bag = asBag(asBag(value)?.stores) ?? asBag(value);
  if (!bag) return null;
  const rows = new Map<string, number>();
  for (const [storeExternalId, entry] of Object.entries(bag)) {
    const storeBag = asBag(entry);
    if (!storeBag) continue;
    // PerformanceCheckpoint：{ synced }；SnapshotCheckpoint：{ metric: { writes } }。
    const synced = asNumber(storeBag.synced);
    const writes = Object.entries(storeBag).reduce((total, [, metric]) => total + asNumber(asBag(metric)?.writes), 0);
    rows.set(storeExternalId, synced + writes);
  }
  return rows.size ? rows : null;
}

/** Listing/Order/货件检查点：Record<externalId, { pageNo, done, count }>。 */
function storeRowsFromPageCheckpoint(value: unknown): Map<string, { rows: number; cursor: Record<string, unknown> }> | null {
  const bag = asBag(value);
  if (!bag) return null;
  const rows = new Map<string, { rows: number; cursor: Record<string, unknown> }>();
  for (const [storeExternalId, entry] of Object.entries(bag)) {
    const state = asBag(entry);
    if (!state) continue;
    rows.set(storeExternalId, { rows: asNumber(state.count), cursor: { pageNo: state.pageNo ?? null, done: state.done === true } });
  }
  return rows.size ? rows : null;
}

/**
 * 从 run 的 request / result / progress 提取分片草稿。
 * 纯函数：不落库，便于单测。结构对不上时退回「单个聚合分片」，宁可粒度粗也不编造店铺明细。
 */
export function buildRunShards(
  resource: string,
  request: { reportDate?: string; startDate?: string; endDate?: string },
  result: unknown,
  progress?: ProgressBag | null,
): SellfoxShardDraft[] {
  const period = periodRange(request);
  const resultRows = rowsFromResult(result);

  if (resource === "stores") {
    return [{ scopeKey: "*", period: "latest", status: "done", rows: resultRows }];
  }

  if (resource === "sales" || resource === "inventory") {
    const snapshots = asBag(asBag(progress)?.snapshots) ?? {};
    const drafts: SellfoxShardDraft[] = [];
    for (const [date, checkpoint] of Object.entries(snapshots)) {
      const perStore = storeRowsFromCheckpoint(checkpoint);
      if (perStore) {
        for (const [storeExternalId, rows] of perStore) {
          drafts.push({ scopeKey: `store:${storeExternalId}`, period: date, status: "done", rows });
        }
      } else {
        drafts.push({ scopeKey: "*", period: date, status: "done", rows: 0 });
      }
    }
    return drafts.length ? drafts : [{ scopeKey: "*", period, status: "done", rows: resultRows }];
  }

  if (resource === "performance") {
    const states = asBag(asBag(progress)?.performance) ?? {};
    const drafts: SellfoxShardDraft[] = [];
    for (const [date, checkpoint] of Object.entries(states)) {
      const perStore = storeRowsFromCheckpoint(checkpoint);
      if (perStore) {
        for (const [storeExternalId, rows] of perStore) {
          drafts.push({ scopeKey: `store:${storeExternalId}`, period: date, status: "done", rows });
        }
      } else {
        drafts.push({ scopeKey: "*", period: date, status: "done", rows: 0 });
      }
    }
    return drafts.length ? drafts : [{ scopeKey: "*", period, status: "done", rows: resultRows }];
  }

  if (resource === "listings" || resource === "orders" || resource === "fba_shipments") {
    const key = resource === "fba_shipments" ? "fba_shipments" : resource;
    const perStore = storeRowsFromPageCheckpoint(asBag(progress)?.[key]);
    if (perStore) {
      return [...perStore.entries()].map(([storeExternalId, state]) => ({
        scopeKey: `store:${storeExternalId}`, period, status: "done", rows: state.rows, cursor: state.cursor,
      }));
    }
    return [{ scopeKey: "*", period, status: "done", rows: resultRows }];
  }

  // 广告六类与后台配置端点的执行结果同构：result.units[].store / rows / status。
  if (resource.startsWith("ads_") || resource.startsWith("endpoint:")) {
    const units = asBag(asBag(result)?.units);
    if (units) {
      const perStore = new Map<string, { rows: number; failed: number }>();
      for (const unit of Object.values(units)) {
        const bag = asBag(unit);
        if (!bag) continue;
        const storeExternalId = typeof bag.store === "string" ? bag.store : "";
        if (!storeExternalId) continue;
        const current = perStore.get(storeExternalId) ?? { rows: 0, failed: 0 };
        current.rows += asNumber(bag.rows);
        if (bag.status === "failed") current.failed += 1;
        perStore.set(storeExternalId, current);
      }
        if (perStore.size) {
          return [...perStore.entries()].map(([storeExternalId, state]) => ({
            scopeKey: storeExternalId === "*" ? "*" : `store:${storeExternalId}`, period, status: state.failed ? "failed" : "done", rows: state.rows,
          }));
        }
    }
    return [{ scopeKey: "*", period, status: "done", rows: resultRows }];
  }

  return [{ scopeKey: "*", period, status: "done", rows: resultRows }];
}

function shardId(request: SellfoxShardRequest, draft: SellfoxShardDraft) {
  return createHash("sha256").update(JSON.stringify([request.organizationId, request.workspaceId, request.resource, draft.scopeKey, draft.period])).digest("hex").slice(0, 40);
}

/** Upsert 分片记录；同一分片重跑时覆盖状态、行数与断点。 */
export async function recordSellfoxShards(request: SellfoxShardRequest, drafts: SellfoxShardDraft[]) {
  if (!drafts.length) return 0;
  let written = 0;
  for (const draft of drafts) {
    const finishedAt = draft.status === "running" ? null : new Date();
    const data = {
      resource: request.resource, scopeKey: draft.scopeKey, period: draft.period,
      status: draft.status, rows: draft.rows,
      cursor: (draft.cursor ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      runId: request.runId, finishedAt,
    };
    await prisma.sellfoxSyncShard.upsert({
      where: { organizationId_workspaceId_resource_scopeKey_period: { organizationId: request.organizationId, workspaceId: request.workspaceId, resource: request.resource, scopeKey: draft.scopeKey, period: draft.period } },
      create: { id: shardId(request, draft), organizationId: request.organizationId, workspaceId: request.workspaceId, ...data },
      update: data,
    });
    written += 1;
  }
  return written;
}

/**
 * 覆盖度数据源白名单：表名与日期列都是静态字符串，不接受外部输入。
 * dateColumn 为 null 表示该表没有业务日期（如 Listing 当前状态），覆盖度只记行数。
 */
export const sellfoxCoverageSources: Record<string, { table: string; dateColumn: string | null }> = {
  sales: { table: "SellfoxSalesDailySnapshot", dateColumn: "reportDate" },
  inventory: { table: "SellfoxFbaInventorySnapshot", dateColumn: "reportDate" },
  performance: { table: "SellfoxProductDailySnapshot", dateColumn: "reportDate" },
  orders: { table: "SellfoxOrderSnapshot", dateColumn: "purchaseDate" },
  listings: { table: "SellfoxListingSnapshot", dateColumn: null },
  fba_shipments: { table: "SellfoxFbaShipmentSnapshot", dateColumn: null },
  hourly: { table: "SellfoxHourlyMetric", dateColumn: "reportDate" },
  ads_report: { table: "SellfoxAdsProductDaily", dateColumn: "reportDate" },
  ads_campaign: { table: "SellfoxAdsCampaignDaily", dateColumn: "reportDate" },
  ads_ad_group: { table: "SellfoxAdsAdGroupDaily", dateColumn: "reportDate" },
  ads_placement: { table: "SellfoxAdsPlacementDaily", dateColumn: "reportDate" },
  ads_targeting: { table: "SellfoxAdsTargetingDaily", dateColumn: "reportDate" },
  ads_search_term: { table: "SellfoxAdsSearchTermDaily", dateColumn: "reportDate" },
};

export function sellfoxCoverageSource(resource: string) {
  return sellfoxCoverageSources[resource] ?? null;
}

/**
 * 从事实表重算「资源 × 店铺」覆盖度并整体替换。
 * 结果与落表数据严格一致：行数就是 count(*)，日期就是 min/max(业务日期)。
 */
export async function refreshSellfoxCoverage(request: SellfoxShardRequest & { status?: string }) {
  const source = sellfoxCoverageSource(request.resource);
  if (!source) return 0;
  // 标识符全部来自 sellfoxCoverageSources 白名单，值走参数化；没有外部输入拼接。
  const dateSelect = source.dateColumn
    ? `, min("${source.dateColumn}") AS "firstDate", max("${source.dateColumn}") AS "lastDate"`
    : `, NULL::text AS "firstDate", NULL::text AS "lastDate"`;
  const sql = `SELECT "storeId" AS "storeId", count(*)::bigint AS n${dateSelect}
     FROM "${source.table}"
     WHERE "organizationId" = $1 AND "workspaceId" = $2
     GROUP BY "storeId"`;
  const rows = await prisma.$queryRawUnsafe<{ storeId: string; n: bigint; firstDate: string | null; lastDate: string | null }[]>(
    sql,
    request.organizationId, request.workspaceId,
  );
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.sellfoxCoverage.deleteMany({ where: { organizationId: request.organizationId, workspaceId: request.workspaceId, resource: request.resource } });
    if (!rows.length) return;
    await tx.sellfoxCoverage.createMany({
      data: rows.map((row) => ({
        id: createHash("sha256").update(JSON.stringify([request.organizationId, request.workspaceId, request.resource, row.storeId])).digest("hex").slice(0, 40),
        organizationId: request.organizationId, workspaceId: request.workspaceId, resource: request.resource,
        storeId: row.storeId, firstDate: row.firstDate, lastDate: row.lastDate, rowCount: Number(row.n),
        lastRunId: request.runId, lastStatus: request.status ?? "done", updatedAt: now,
      })),
    });
  });
  return rows.length;
}
