import { getSellfoxCredentialStatus } from "@/lib/sellfox/credential-store";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { resolveSellfoxVisibleStoreIds } from "@/lib/sellfox/store-access";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { deriveSellfoxWatermarks } from "@/lib/sellfox/watermark";
import { prisma as dbPrisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { normalizeSellfoxCacheQuery, overviewStoreScopeParts, readThroughSellfox, sellfoxOverviewCacheKey } from "@/lib/sellfox/result-cache";

export const runtime = "nodejs";

/** Composite version of the snapshot tables the overview aggregates. */
async function overviewVersion(organizationId: string, workspaceId: string): Promise<string> {
  try {
    const rows = await dbPrisma.$queryRaw<Array<{ v: Date | string | null }>>(Prisma.sql`
      SELECT greatest(
        (SELECT max("syncedAt") FROM "SellfoxSalesDailySnapshot" WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}),
        (SELECT max("syncedAt") FROM "SellfoxProductDailySnapshot" WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}),
        (SELECT max("capturedAt") FROM "SellfoxListingSnapshot" WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}),
        (SELECT max("capturedAt") FROM "SellfoxFbaInventorySnapshot" WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}),
        (SELECT max("syncedAt") FROM "SellfoxHourlyMetric" WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId})
      ) AS v`);
    const value = rows[0]?.v;
    return value ? new Date(value).toISOString() : "__empty__";
  } catch { return "__empty__"; }
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;

    const scope = workspaceScopeFromRequest(request);
    const where = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };

    // 数据级权限隔离：与主工作台 /api/sellfox/[domain] 走同一套权限源
    // （resolveSellfoxVisibleStoreIds → sellfoxDataAccessGrant / sellfoxRoleDataAccessGrant），
    // 保证「概览数字」与「点进去的明细」可见店铺完全一致，不会出现概览看得到、明细看不到。
    // 返回 undefined = 不收紧（管理员 / 工作区未启用授权），保持旧行为；返回 [] = 强制空集。
    const authorizedStoreIds = await resolveSellfoxVisibleStoreIds(
      { id: permission.user.id, role: permission.user.role },
      where,
    );

    // 缓存键与 Prisma 过滤条件统一从这里取，保证三态（全量/空集/子集）互不串数据。
    const parts = overviewStoreScopeParts(authorizedStoreIds);
    const scopeKey = normalizeSellfoxCacheQuery({
      organizationId: where.organizationId, workspaceId: where.workspaceId,
      accountId: scope.accountId ?? "", marketplace: scope.marketplace ?? "",
      storeIds: parts.storeKeyPart,
    });
    const key = sellfoxOverviewCacheKey(where.organizationId, where.workspaceId, scopeKey);
    const storeScoped = parts.storeWhere;
    const storeTableScoped = parts.storeTableWhere;

    const load = async () => {
    // 最早可查日期：供空态提示使用；查不到保留 null（不补零值、不伪造日期）。
    const [earliestSalesRow, earliestPerformanceRow] = await Promise.all([
      prisma.sellfoxSalesDailySnapshot.findFirst({ where: { ...where, ...storeScoped }, orderBy: { reportDate: "asc" }, select: { reportDate: true } }),
      prisma.sellfoxProductDailySnapshot.findFirst({ where: { ...where, ...storeScoped, onlySettle: false }, orderBy: { reportDate: "asc" }, select: { reportDate: true } }),
    ]);
    const [stores, hourlyCount, inventoryCount, salesCount, performanceCount, inventoryCoverage, salesCoverage, latestRun, latestHourlyRun, latestPerformanceRun, latestMetric, latestRuns, latestSuccessRuns, heartbeat] = await Promise.all([
      prisma.sellfoxStore.findMany({ where: { ...where, ...storeTableScoped }, select: { id: true, externalId: true, name: true, marketplace: true, country: true, status: true, lastSyncedAt: true }, orderBy: { name: "asc" } }),
      prisma.sellfoxHourlyMetric.count({ where: { ...where, ...storeScoped } }),
      prisma.sellfoxFbaInventorySnapshot.count({ where: { ...where, ...storeScoped } }),
      prisma.sellfoxSalesDailySnapshot.count({ where: { ...where, ...storeScoped } }),
      prisma.sellfoxProductDailySnapshot.count({ where: { ...where, ...storeScoped, onlySettle: false } }),
      prisma.sellfoxFbaInventorySnapshot.findMany({ where: { ...where, ...storeScoped }, distinct: ["storeId"], select: { storeId: true } }),
      prisma.sellfoxSalesDailySnapshot.findMany({ where: { ...where, ...storeScoped }, distinct: ["storeId"], select: { storeId: true } }),
      // 同步运行记录（SellfoxSyncRun）无 storeId 列，属 workspace 级运维状态，保持全量。
      prisma.sellfoxSyncRun.findFirst({ where, orderBy: { startedAt: "desc" } }),
      prisma.sellfoxSyncRun.findFirst({ where: { ...where, resource: "hourly", status: "done" }, orderBy: { startedAt: "desc" } }),
      prisma.sellfoxSyncRun.findFirst({ where: { ...where, resource: "performance" }, orderBy: { startedAt: "desc" } }),
      prisma.sellfoxHourlyMetric.findFirst({ where: { ...where, ...storeScoped }, orderBy: { syncedAt: "desc" } }),
      prisma.sellfoxSyncRun.findMany({ where, orderBy: { startedAt: "desc" }, take: 20, select: { id: true, resource: true, status: true, summary: true, error: true, startedAt: true, finishedAt: true } }),
      Promise.all(["stores", "inventory", "sales", "performance", "hourly"].map((resource) => prisma.sellfoxSyncRun.findFirst({ where: { ...where, resource, status: "done" }, orderBy: { startedAt: "desc" }, select: { id: true, resource: true, status: true, summary: true, error: true, startedAt: true, finishedAt: true } }))),
      prisma.workerHeartbeat.findFirst({ where: { queueName: "sellfox-sync-jobs", status: "online", lastSeenAt: { gte: new Date(Date.now() - 90_000) } }, orderBy: { lastSeenAt: "desc" }, select: { id: true, lastSeenAt: true } }),
    ]);

    // 水位线派生自 workspace 级 run.summary，含店铺 externalId；显示层按可见店铺再收一层，
    // 避免把无权店铺标识透露给受限用户。全量用户（authorizedStoreIds=null）不过滤。
    const visibleExternalIds = new Set(stores.map((store) => store.externalId));

    // load 必须返回普通数据对象：readThroughSellfox 会把该返回值作为 body 缓存，
    // 外层统一用 NextResponse.json({ ...result.body, cache }) 包裹。若这里直接返回
    // NextResponse.json(...)，Response 的业务字段不在对象自有属性上，展开后 body 只剩
    // 空对象 + cache，前端 body.stores ?? [] 恒为空 → 站点/店铺/业务员下拉全空。
    return {
      configured: (await getSellfoxCredentialStatus(where)).configured,
      stores,
      hourlyCount,
      counts: { stores: stores.length, inventory: inventoryCount, sales: salesCount, performance: performanceCount, hourly: hourlyCount },
      coverage: { inventoryStores: inventoryCoverage.length, inventoryMissingStores: Math.max(0, stores.length - inventoryCoverage.length), salesStores: salesCoverage.length, salesMissingStores: Math.max(0, stores.length - salesCoverage.length) },
      latestRuns,
      latestSuccessByResource: Object.fromEntries(latestSuccessRuns.filter((run) => run !== null).map((run) => [run.resource, run])),
      workerOnline: Boolean(heartbeat),
      latestRun,
      latestPerformanceRun,
      nextHourlyStoreOffset: (() => {
        const summary = latestHourlyRun?.summary as { storeOffset?: unknown; storeLimit?: unknown } | null;
        return Math.max(0, Number(summary?.storeOffset) || 0) + Math.max(1, Number(summary?.storeLimit) || 1);
      })(),
      latestMetricAt: latestMetric?.syncedAt ?? null,
      // 三元组水位线（resource × 店铺）可观测样本，派生自最近成功 run；不参与游标推进。
      watermarks: Array.from(deriveSellfoxWatermarks(latestRuns).entries())
        .filter(([key]) => {
          if (!authorizedStoreIds) return true;
          const [, shopExternalId] = key.split("\u0000");
          return visibleExternalIds.has(shopExternalId);
        })
        .map(([key, value]) => {
          const [resource, shopExternalId] = key.split("\u0000");
          return { resource, shopExternalId, lastSuccessAt: value.lastSuccessAt?.toISOString() ?? null, lastReportDate: value.lastReportDate };
        }),
      earliestReportDate: {
        sales: earliestSalesRow?.reportDate ?? null,
        performance: earliestPerformanceRow?.reportDate ?? null,
      },
    };
    };
    const result = await readThroughSellfox(
      key, "overview",
      () => overviewVersion(where.organizationId, where.workspaceId),
      load,
      { isEmpty: (body) => (body as { stores?: unknown[] }).stores?.length === 0 },
    );
    return NextResponse.json({ ...result.body, cache: { status: result.cache, cachedAt: result.cachedAt } });
  } catch {
    return NextResponse.json({ error: "读取赛狐概览失败，请稍后重试。" }, { status: 500 });
  }
}
