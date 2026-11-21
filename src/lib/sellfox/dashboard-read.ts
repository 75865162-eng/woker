/**
 * 经营作战看板 Reader（首页驾驶舱的权威数据入口）。
 *
 * 设计约束（对齐任务书 2.1 经营总览 / 3.2 权威 Reader）：
 * - 一次读取返回所有看板卡片，避免每张卡各自查接口、重复聚合；
 * - 店铺可见性用权限三态收窄（undefined 全量 / [] 空集 / ids 子集），
 *   与 overview / 明细页完全同源，绝不出现"看板看得到、点进去看不到"；
 * - 销售汇总复用 readSalesSummary（经聚合闸门，异常回退 live），不碰巨型 CTE；
 * - 缺失数据留 null / 空数组，不补零、不伪造日期；
 * - 所有子查询并行，任一非致命失败只让对应卡片降级为空，不影响整页。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { readSalesSummary, type SalesSummary } from "@/lib/sellfox/sales-summary";
import { loadPendingWorkflowNotifications } from "@/lib/notifications/pending-workflow-notifications";
import { overviewStoreScopeParts } from "@/lib/sellfox/result-cache";

export type DashboardScope = {
  organizationId: string;
  workspaceId: string;
  userId: string;
};

export type DashboardKpi = {
  key: string;
  label: string;
  value: number | null;
  currency: string | null;
  source: string | null;
};

export type DashboardRankRow = {
  storeId: string;
  storeName: string;
  revenue: number | null;
  quantity: number;
};

export type DashboardData = {
  generatedAt: string;
  window: { from: string; to: string };
  sales: SalesSummary;
  kpis: DashboardKpi[];
  ranking: DashboardRankRow[];
  pendingCount: number;
  coverage: { stores: number; salesDays: number; inventoryRows: number; lastSyncAt: string | null };
  degraded: string[];
};

type Deps = {
  prisma?: typeof prisma;
  now?: Date;
  readSalesSummary?: typeof readSalesSummary;
  loadPending?: typeof loadPendingWorkflowNotifications;
};

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDays(base: Date, days: number): Date {
  const copy = new Date(base);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function sumRevenue(points: SalesSummary["points"]): { value: number | null; currency: string | null } {
  // 不同币种不可直接相加：只有全部点同币种时给出汇总，否则留 null 让前端显示"多币种"。
  const currencies = new Set(points.map((p) => p.currency).filter((c): c is string => Boolean(c)));
  if (currencies.size !== 1) return { value: null, currency: currencies.size > 1 ? "MULTI" : null };
  const currency = [...currencies][0];
  const relevant = points.filter((p) => p.currency === currency && p.revenue !== null);
  if (!relevant.length) return { value: null, currency };
  const total = relevant.reduce((sum, p) => sum + Number(p.revenue), 0);
  return { value: Math.round(total * 100) / 100, currency };
}

/**
 * 读取首页作战看板数据。authorizedStoreIds 是权限三态结果。
 */
export async function readDashboard(
  scope: DashboardScope,
  authorizedStoreIds: string[] | undefined,
  deps: Deps = {},
): Promise<DashboardData> {
  const db = deps.prisma ?? prisma;
  const now = deps.now ?? new Date();
  const readSales = deps.readSalesSummary ?? readSalesSummary;
  const loadPending = deps.loadPending ?? loadPendingWorkflowNotifications;
  const parts = overviewStoreScopeParts(authorizedStoreIds);
  const storeScoped = parts.storeWhere;
  const storeTableScoped = parts.storeTableWhere;
  const windowFrom = dayString(shiftDays(now, -29));
  const windowTo = dayString(now);
  const degraded: string[] = [];

  // 销售汇总：复用权威 Reader，已做闸门切换与异常回退，本身不按店铺收窄——
  // 受限用户需要收窄时，改用带 store 过滤的查询（下方 salesScoped）。
  const salesPromise = parts.restrict
    ? readScopedSales(db, scope, authorizedStoreIds ?? [], windowFrom, windowTo, degraded, "sales")
    : readSales({ organizationId: scope.organizationId, workspaceId: scope.workspaceId }, windowFrom, windowTo)
        .catch(() => {
          degraded.push("sales");
          return emptySales();
        });

  const [sales, kpiRows, ranking, pendingCount, coverage] = await Promise.all([
    salesPromise,
    readAggregateKpis(db, scope, storeScoped, windowFrom, windowTo, degraded),
    readRanking(db, scope, authorizedStoreIds, windowFrom, windowTo, degraded),
    loadPending(scope.organizationId, scope.userId).then((items) => items.length).catch(() => {
      degraded.push("pending");
      return 0;
    }),
    readCoverage(db, scope, storeScoped, storeTableScoped, degraded),
  ]);

  const revenueTotal = sumRevenue(sales.points);
  const quantityTotal = sales.points.reduce((sum, p) => sum + p.quantity, 0);
  const ordersTotal = sales.points.reduce((sum, p) => sum + p.orders, 0);

  const kpis: DashboardKpi[] = [
    { key: "revenue", label: "销售额(近30天)", value: revenueTotal.value, currency: revenueTotal.currency, source: sales.source },
    { key: "orders", label: "订单量(近30天)", value: ordersTotal, currency: null, source: sales.source },
    { key: "quantity", label: "销量(近30天)", value: quantityTotal, currency: null, source: sales.source },
    ...kpiRows,
  ];

  return {
    generatedAt: now.toISOString(),
    window: { from: windowFrom, to: windowTo },
    sales,
    kpis,
    ranking,
    pendingCount,
    coverage,
    degraded,
  };
}

function emptySales(): SalesSummary {
  return { source: "live", points: [], coverage: { rows: 0, earliest: null, latest: null } };
}

async function readScopedSales(
  db: typeof prisma,
  scope: DashboardScope,
  storeIds: string[],
  from: string,
  to: string,
  degraded: string[],
  tag: string,
): Promise<SalesSummary> {
  if (!storeIds.length) return emptySales();
  try {
    const rows = await db.$queryRaw<Array<{ reportDate: string; quantity: bigint | number; orders: bigint | number; revenue: string | null; currency: string | null }>>(Prisma.sql`
      SELECT t."reportDate" AS "reportDate",
        SUM(t."quantity")::bigint AS quantity,
        SUM(t."orders")::bigint AS orders,
        CASE WHEN count(t."revenue")=count(*) THEN SUM(t."revenue")::text END AS revenue,
        max(t."currency") AS currency
      FROM "SellfoxSalesDailySnapshot" t
      WHERE t."organizationId"=${scope.organizationId} AND t."workspaceId"=${scope.workspaceId}
        AND t."storeId" IN (${Prisma.join(storeIds)})
        AND t."reportDate" BETWEEN ${from} AND ${to}
      GROUP BY t."reportDate" ORDER BY t."reportDate"
    `);
    return {
      source: "live",
      points: rows.map((r) => ({
        reportDate: r.reportDate,
        quantity: Number(r.quantity ?? 0),
        orders: Number(r.orders ?? 0),
        revenue: r.revenue ?? null,
        currency: r.currency ?? null,
      })),
      coverage: { rows: rows.length, earliest: rows[0]?.reportDate ?? null, latest: rows[rows.length - 1]?.reportDate ?? null },
    };
  } catch {
    degraded.push(tag);
    return emptySales();
  }
}

async function readAggregateKpis(
  db: typeof prisma,
  scope: DashboardScope,
  storeScoped: Record<string, unknown>,
  from: string,
  to: string,
  degraded: string[],
): Promise<DashboardKpi[]> {
  try {
    const [profit, ads, inventory] = await Promise.all([
      db.sellfoxProfitAggDaily.findMany({
        where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, reportDate: { gte: from, lte: to } },
        select: { netRevenue: true, grossProfit: true, currency: true },
      }).catch(() => null),
      db.sellfoxAdsAggDaily.findMany({
        where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, reportDate: { gte: from, lte: to } },
        select: { cost: true, adSales: true, currency: true },
      }).catch(() => null),
      // 用按 Head 去重的预聚合读模型（约 8.8k 行），而非原始快照表（108 万行、含 6.9x 历史版本）。
      // 原始表直接 SUM 既重复累加历史快照（语义错），又在真实数据上稳定 ~12s（性能错）。
      // SellfoxInventoryAgg 与库存浏览页同源当前态口径，带 (org,ws) 索引，实测 ~28ms。
      db.sellfoxInventoryAgg.aggregate({
        where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...storeScoped },
        _sum: { quantity: true, inTransit: true },
      }).catch(() => null),
    ]);
    const out: DashboardKpi[] = [];
    if (profit && profit.length) {
      const currency = profit[0]?.currency ?? null;
      const net = profit.reduce((s, r) => s + Number(r.netRevenue ?? 0), 0);
      out.push({ key: "netRevenue", label: "净销售额(近30天)", value: Math.round(net * 100) / 100, currency, source: "aggregate" });
    }
    if (ads && ads.length) {
      const currency = ads[0]?.currency ?? null;
      const cost = ads.reduce((s, r) => s + Number(r.cost ?? 0), 0);
      out.push({ key: "adSpend", label: "广告花费(近30天)", value: Math.round(cost * 100) / 100, currency, source: "aggregate" });
    }
    if (inventory) {
      out.push({ key: "inventory", label: "FBA在库", value: Number(inventory._sum.quantity ?? 0), currency: null, source: "snapshot" });
      out.push({ key: "inTransit", label: "在途库存", value: Number(inventory._sum.inTransit ?? 0), currency: null, source: "snapshot" });
    }
    return out;
  } catch {
    degraded.push("kpis");
    return [];
  }
}

async function readRanking(
  db: typeof prisma,
  scope: DashboardScope,
  authorizedStoreIds: string[] | undefined,
  from: string,
  to: string,
  degraded: string[],
): Promise<DashboardRankRow[]> {
  try {
    const rows = await db.$queryRaw<Array<{ storeId: string; storeName: string; revenue: string | null; quantity: bigint | number }>>(Prisma.sql`
      SELECT s."storeId" AS "storeId",
        max(st."name") AS "storeName",
        CASE WHEN count(a."revenueOriginal")=count(*) THEN SUM(a."revenueOriginal")::text END AS revenue,
        SUM(a."quantity")::bigint AS quantity
      FROM "SellfoxSalesAggDaily" a
      JOIN "SellfoxStore" st ON st."id" = a."storeId" AND st."organizationId" = a."organizationId" AND st."workspaceId" = a."workspaceId"
      JOIN (SELECT DISTINCT "storeId" FROM "SellfoxSalesAggDaily" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND "reportDate" BETWEEN ${from} AND ${to}) s ON s."storeId" = a."storeId"
      WHERE a."organizationId"=${scope.organizationId} AND a."workspaceId"=${scope.workspaceId}
        AND a."reportDate" BETWEEN ${from} AND ${to}
      GROUP BY s."storeId" ORDER BY SUM(a."quantity") DESC LIMIT 10
    `);
    const visible = authorizedStoreIds === undefined ? undefined : new Set(authorizedStoreIds);
    return rows
      .filter((r) => !visible || visible.has(r.storeId))
      .map((r) => ({ storeId: r.storeId, storeName: r.storeName || r.storeId, revenue: r.revenue === null ? null : Number(r.revenue), quantity: Number(r.quantity ?? 0) }));
  } catch {
    degraded.push("ranking");
    return [];
  }
}

async function readCoverage(
  db: typeof prisma,
  scope: DashboardScope,
  storeScoped: Record<string, unknown>,
  storeTableScoped: Record<string, unknown>,
  degraded: string[],
): Promise<DashboardData["coverage"]> {
  try {
    const [stores, salesDays, inventoryRows, lastRun] = await Promise.all([
      db.sellfoxStore.count({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...storeTableScoped } }).catch(() => 0),
      db.sellfoxSalesDailySnapshot.count({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...storeScoped } }).catch(() => 0),
      // 覆盖率同样读当前态预聚合表，避免对 108 万行原始快照 count（实测 ~12s）。
      db.sellfoxInventoryAgg.count({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...storeScoped } }).catch(() => 0),
      db.sellfoxSyncRun.findFirst({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, status: "done" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true } }).catch(() => null),
    ]);
    return {
      stores,
      salesDays,
      inventoryRows,
      lastSyncAt: lastRun?.finishedAt?.toISOString() ?? null,
    };
  } catch {
    degraded.push("coverage");
    return { stores: 0, salesDays: 0, inventoryRows: 0, lastSyncAt: null };
  }
}
