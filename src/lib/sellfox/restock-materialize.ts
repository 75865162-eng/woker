/**
 * 补货建议物化（派生读模型，以赛狐 buildRestockRows 算法为权威）。
 *
 * 设计纪律：
 *  - 结果完全来自 readSellfoxRestock 的纯算法输出（fullRows=true），不是新事实；
 *  - 按 (org,ws,dimension,inputDate) 幂等 upsert，重复执行不产生重复数据；
 *  - inputVersion 取 FBA 库存快照 capturedAt，与读缓存失效版本同源；
 *  - 物化写入不改变任何页面读路径：API 默认走 live，只有显式 source=materialized
 *    且对账 0 差异才读物化表（见 restock-read.ts 的 materialized 分支）。
 *  - 与 operations.AmazonReplenishmentPlan 是两套独立算法，绝不共用。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { SellfoxBrowseQuery } from "./browse-query";
import { readSellfoxRestock } from "./restock-read";
import { sellfoxDateAt } from "./sync-contract";

export type MaterializeRestockInput = {
  organizationId: string;
  workspaceId: string;
  dimensions?: Array<"asin" | "msku">;
  today?: string;
  /** 用户可见店铺集合（权限范围）；物化全量时传 undefined。 */
  storeIds?: string[];
};

/** Stable snapshot id for a given scope/dimension/day. */
export function restockSnapshotId(organizationId: string, workspaceId: string, dimension: string, inputDate: string) {
  return `restocksnap|${organizationId}|${workspaceId}|${dimension}|${inputDate}`;
}

async function latestInventoryVersion(organizationId: string, workspaceId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ v: Date | string | null }>>(Prisma.sql`
    SELECT max("capturedAt") AS v FROM "SellfoxFbaInventorySnapshot"
    WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}`);
  const value = rows[0]?.v;
  return value ? new Date(value).toISOString() : null;
}

/** Base browse query for a full (unpaginated, unfiltered) materialization of one dimension. */
function baseQuery(dimension: "asin" | "msku"): SellfoxBrowseQuery {
  return {
    page: 1, pageSize: 1, search: "", searchType: "", exactMatch: false,
    status: "", dimension, shopExternalIds: [], site: "", shop: "", fulfillment: "",
  } as unknown as SellfoxBrowseQuery;
}

/**
 * Materialize the complete restock result for each requested dimension.
 * Idempotent upsert; returns per-dimension row counts and the input version.
 */
export async function materializeSellfoxRestock(input: MaterializeRestockInput) {
  const today = input.today ?? sellfoxDateAt(new Date());
  const dimensions = input.dimensions ?? (["asin", "msku"] as const);
  const inputVersion = await latestInventoryVersion(input.organizationId, input.workspaceId);
  const scope = { organizationId: input.organizationId, workspaceId: input.workspaceId };
  const results: Array<{ dimension: string; rowCount: number; suggestTotal: number | null; snapshotId: string }> = [];

  for (const dimension of dimensions) {
    const computed = await readSellfoxRestock(baseQuery(dimension), scope, input.storeIds, today, true);
    const rows = computed.rows;
    const suggestTotal = rows.length > 0 && rows.every((row) => row.suggest != null)
      ? rows.reduce((sum, row) => sum + Number(row.suggest), 0)
      : null;
    const snapshotId = restockSnapshotId(input.organizationId, input.workspaceId, dimension, today);
    await prisma.sellfoxRestockSnapshot.upsert({
      where: {
        organizationId_workspaceId_dimension_inputDate: {
          organizationId: input.organizationId, workspaceId: input.workspaceId, dimension, inputDate: today,
        },
      },
      create: {
        id: snapshotId, ...scope, dimension, inputDate: today,
        rowCount: rows.length,
        suggestTotal: suggestTotal == null ? null : new Prisma.Decimal(suggestTotal),
        rows: rows as unknown as Prisma.InputJsonValue,
        inputVersion,
      },
      update: {
        rowCount: rows.length,
        suggestTotal: suggestTotal == null ? null : new Prisma.Decimal(suggestTotal),
        rows: rows as unknown as Prisma.InputJsonValue,
        inputVersion, generatedAt: new Date(),
      },
    });
    results.push({ dimension, rowCount: rows.length, suggestTotal, snapshotId });
  }

  return { scope, inputDate: today, inputVersion, materialized: results };
}

export type RestockReconcileReport = {
  scope: { organizationId: string; workspaceId: string; dimension: string; inputDate: string };
  materializedRows: number;
  liveRows: number;
  diffRows: Array<{ id: string; fields: Array<{ field: string; materialized: string | null; live: string | null }> }>;
  ok: boolean;
};

function normRestock(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  return String(value);
}

/**
 * Reconcile a materialized restock snapshot against a fresh live computation,
 * row by row and field by field. This is the read-cutover gate: only when 0 diff
 * is reported may `source=materialized` be trusted for that scope/dimension/day.
 */
export async function reconcileSellfoxRestockSnapshot(input: {
  organizationId: string;
  workspaceId: string;
  dimension: "asin" | "msku";
  today?: string;
  storeIds?: string[];
}): Promise<RestockReconcileReport> {
  const today = input.today ?? sellfoxDateAt(new Date());
  const scope = { organizationId: input.organizationId, workspaceId: input.workspaceId };
  const snapshot = await prisma.sellfoxRestockSnapshot.findUnique({
    where: {
      organizationId_workspaceId_dimension_inputDate: {
        organizationId: input.organizationId, workspaceId: input.workspaceId,
        dimension: input.dimension, inputDate: today,
      },
    },
  });
  const materialized = (snapshot?.rows ?? []) as unknown as Array<Record<string, unknown>>;
  const live = (await readSellfoxRestock(baseQuery(input.dimension), scope, input.storeIds, today, true)).rows as unknown as Array<Record<string, unknown>>;

  const matMap = new Map(materialized.map((row) => [String(row.id), row]));
  const liveMap = new Map(live.map((row) => [String(row.id), row]));
  const keys = new Set([...matMap.keys(), ...liveMap.keys()]);
  const fields = [
    "asin", "msku", "sku", "title", "parentAsin", "store", "fulfillable", "reservedQty",
    "unsellable", "warehousing", "inTransit", "avg7", "avg14", "avg30", "daily", "cover",
    "suggest", "suggestDate",
  ];
  const diffRows: RestockReconcileReport["diffRows"] = [];
  for (const key of keys) {
    const m = matMap.get(key);
    const l = liveMap.get(key);
    const fieldDiffs: Array<{ field: string; materialized: string | null; live: string | null }> = [];
    for (const field of fields) {
      const mv = m ? normRestock(m[field]) : null;
      const lv = l ? normRestock(l[field]) : null;
      if (mv !== lv) fieldDiffs.push({ field, materialized: mv, live: lv });
    }
    if (fieldDiffs.length) diffRows.push({ id: key, fields: fieldDiffs });
  }
  return {
    scope: { ...scope, dimension: input.dimension, inputDate: today },
    materializedRows: materialized.length,
    liveRows: live.length,
    diffRows,
    ok: diffRows.length === 0 && materialized.length === live.length,
  };
}
