/**
 * 赛狐销量汇总 Reader（经营总览的权威轻量指标源）。
 *
 * 这是 aggregate-read-gate 的第一个真实生产接入点：
 * - 字段完全对齐 SalesAggDaily（quantity/orders/revenueOriginal/currencyOriginal），
 *   可用 reconcileSalesAggDaily 做 0-diff 对账；
 * - 经闸门切换：env 总开关 + 该域 verdict=ok + 聚合有数据 → 读预聚合；否则回退 live 事实表；
 * - 只返回稳定 DTO（按币种汇总的日指标），不碰重型 workbench CTE 的 100+ 字段。
 *
 * 默认行为不变：SELLFOX_AGG_READ_ENABLED 未开或 verdict 缺失时走 live，绝不出空页。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { aggregateReadEnabled, resolveAggregateCutover } from "@/lib/sellfox/aggregate-read-gate";
import { aggregateCutoverReady } from "@/lib/sellfox/aggregate-read-state";

export type Scope = { organizationId: string; workspaceId: string };
export type SalesSummaryPoint = { reportDate: string; quantity: number; orders: number; revenue: string | null; currency: string | null };
export type SalesSummary = {
  source: "aggregate" | "live";
  points: SalesSummaryPoint[];
  coverage: { rows: number; earliest: string | null; latest: string | null };
};

type Deps = {
  prisma?: typeof prisma;
  switchEnabled?: boolean;
  verdictOk?: boolean;
};

function liveStatement(db: typeof prisma, scope: Scope, from: string, to: string) {
  return db.$queryRaw<Array<{ reportDate: string; quantity: bigint | number; orders: bigint | number; revenue: string | null; currency: string | null }>>(Prisma.sql`
    SELECT t."reportDate" AS "reportDate",
      SUM(t."quantity")::bigint AS quantity,
      SUM(t."orders")::bigint AS orders,
      CASE WHEN count(t."revenue")=count(*) THEN SUM(t."revenue")::text END AS revenue,
      max(t."currency") AS currency
    FROM "SellfoxSalesDailySnapshot" t
    WHERE t."organizationId"=${scope.organizationId} AND t."workspaceId"=${scope.workspaceId}
      AND t."reportDate" BETWEEN ${from} AND ${to}
    GROUP BY t."reportDate" ORDER BY t."reportDate"
  `);
}

function aggregateStatement(db: typeof prisma, scope: Scope, from: string, to: string) {
  return db.$queryRaw<Array<{ reportDate: string; quantity: bigint | number; orders: bigint | number; revenue: string | null; currency: string | null }>>(Prisma.sql`
    SELECT a."reportDate" AS "reportDate",
      SUM(a."quantity")::bigint AS quantity,
      SUM(a."orders")::bigint AS orders,
      CASE WHEN count(a."revenueOriginal")=count(*) THEN SUM(a."revenueOriginal")::text END AS revenue,
      max(a."currencyOriginal") AS currency
    FROM "SellfoxSalesAggDaily" a
    WHERE a."organizationId"=${scope.organizationId} AND a."workspaceId"=${scope.workspaceId}
      AND a."reportDate" BETWEEN ${from} AND ${to}
    GROUP BY a."reportDate" ORDER BY a."reportDate"
  `);
}

function toSummary(rows: Array<{ reportDate: string; quantity: bigint | number; orders: bigint | number; revenue: string | null; currency: string | null }>, source: "aggregate" | "live"): SalesSummary {
  const points = rows.map((r) => ({
    reportDate: r.reportDate,
    quantity: Number(r.quantity ?? 0),
    orders: Number(r.orders ?? 0),
    revenue: r.revenue ?? null,
    currency: r.currency ?? null,
  }));
  return {
    source,
    points,
    coverage: {
      rows: points.length,
      earliest: points[0]?.reportDate ?? null,
      latest: points[points.length - 1]?.reportDate ?? null,
    },
  };
}

/**
 * 读取日销量汇总。经闸门决定读聚合或 live；闸门的三要素可注入以便单测。
 */
export async function readSalesSummary(
  scope: Scope,
  from: string,
  to: string,
  deps: Deps = {},
): Promise<SalesSummary> {
  const db = deps.prisma ?? prisma;
  const switchEnabled = deps.switchEnabled ?? aggregateReadEnabled();
  const verdictOk = deps.verdictOk ?? await aggregateCutoverReady(scope.organizationId, scope.workspaceId, "sales");

  // 先探测聚合是否有数据（闸门要求），再决定；探测失败按无数据处理 → live。
  let aggregateHasRows = false;
  if (switchEnabled && verdictOk) {
    try {
      const probe = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT count(*)::bigint AS n FROM "SellfoxSalesAggDaily"
        WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId}
          AND "reportDate" BETWEEN ${from} AND ${to}
      `);
      aggregateHasRows = Number(probe[0]?.n ?? 0) > 0;
    } catch { aggregateHasRows = false; }
  }

  const decision = resolveAggregateCutover({ switchEnabled, verdictOk, aggregateHasRows });
  if (decision.useAggregate) {
    try {
      const rows = await aggregateStatement(db, scope, from, to);
      return toSummary(rows, "aggregate");
    } catch {
      // 聚合读取异常 → live 兜底，绝不出空页。
      return toSummary(await liveStatement(db, scope, from, to), "live");
    }
  }
  return toSummary(await liveStatement(db, scope, from, to), "live");
}
