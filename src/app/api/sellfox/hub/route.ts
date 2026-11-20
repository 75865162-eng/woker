import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getSellfoxCredentialStatus } from "@/lib/sellfox/credential-store";
import { sellfoxLiveDatasets, sellfoxPlanSummary } from "@/lib/sellfox/data-plan";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { getHubDatasetStats, hubOverviewCacheKey } from "@/lib/sellfox/hub-overview-cache";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;
    const organizationId = permission.user.organizationId;
    const workspaceId = workspaceScopeFromRequest(request).workspaceId;
    const where = { organizationId, workspaceId };

    const [credential, stores, runs, heartbeat, shards, coverage] = await Promise.all([
      getSellfoxCredentialStatus(where),
      prisma.sellfoxStore.findMany({ where, select: { externalId: true, name: true, marketplace: true, country: true, status: true, lastSyncedAt: true }, orderBy: { name: "asc" } }),
      prisma.sellfoxSyncRun.findMany({ where, orderBy: { startedAt: "desc" }, take: 40, select: { id: true, resource: true, status: true, error: true, summary: true, startedAt: true, finishedAt: true } }),
      prisma.workerHeartbeat.findFirst({ where: { queueName: "sellfox-sync-jobs", status: "online", lastSeenAt: { gte: new Date(Date.now() - 90_000) } }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
      prisma.sellfoxSyncShard.findMany({ where, orderBy: { updatedAt: "desc" }, take: 30 }),
      prisma.sellfoxCoverage.groupBy({ by: ["resource"], where, _sum: { rowCount: true }, _count: { _all: true }, _max: { lastDate: true, firstDate: true, lastStatus: true } }),
    ]);

    // Per-dataset statistics are derived from SellfoxCoverage, which the sync
    // worker maintains as a per-(resource,store) rollup: rowCount, lastDate and
    // store coverage. Reading the aggregate avoids `count(distinct storeId) +
    // max(date)` full sequential scans over the 1,000,000+ row inventory table
    // on every cold hub open (measured 13s). Coverage rows are kept in sync by
    // the same worker that writes the snapshot tables, so the numbers match the
    // fact tables exactly (production check: inventory 1,018,043 == coverage
    // sum(rowCount)). Live fields such as lastRun status are still rebuilt per
    // request. The short-TTL cache remains as a cheap guard for rapid opens.
    const coverageByResource = new Map(coverage.map((row) => [row.resource, row]));
    const computeStats = () => Promise.resolve(sellfoxLiveDatasets.map((dataset) => {
      const cov = coverageByResource.get(dataset.resource);
      return {
        key: dataset.key,
        rows: Number(cov?._sum.rowCount ?? 0),
        latest: cov?._max.lastDate ?? null,
        storesWithData: cov?._count._all ?? 0,
        readError: null,
      };
    }));
    const stats = await getHubDatasetStats(hubOverviewCacheKey(organizationId, workspaceId), computeStats);
    const statByKey = new Map(stats.map((stat) => [stat.key, stat]));
    const datasets = sellfoxLiveDatasets.map((dataset) => {
      const lastRun = runs.find((run) => run.resource === dataset.resource) ?? null;
      const stat = statByKey.get(dataset.key);
      return {
        key: dataset.key, label: dataset.label, resource: dataset.resource, table: dataset.table, href: dataset.href ?? null,
        lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, error: lastRun.error } : null,
        rows: stat?.rows ?? 0, latest: stat?.latest ?? null, storesWithData: stat?.storesWithData ?? 0, readError: stat?.readError ?? null,
      };
    });

    const hourly = await prisma.sellfoxHourlyMetric.count({ where });
    const lastSuccess = new Map<string, string>();
    for (const run of runs) if (run.status === "done" && !lastSuccess.has(run.resource)) lastSuccess.set(run.resource, (run.finishedAt ?? run.startedAt).toISOString());

    return NextResponse.json({
      configured: credential.configured,
      credentialSource: credential.source,
      encryptionReady: credential.encryptionReady,
      workerOnline: Boolean(heartbeat),
      stores,
      storeCount: stores.length,
      datasets,
      hourlyRows: hourly,
      coverage: coverage.map((row) => ({
        resource: row.resource,
        stores: row._count._all,
        rows: Number(row._sum.rowCount ?? 0),
        firstDate: row._max.firstDate ?? null,
        lastDate: row._max.lastDate ?? null,
        lastStatus: row._max.lastStatus ?? null,
      })),
      shards: shards.map((shard) => ({
        resource: shard.resource, scopeKey: shard.scopeKey, period: shard.period, status: shard.status,
        rows: shard.rows, cursor: shard.cursor, runId: shard.runId, updatedAt: shard.updatedAt, finishedAt: shard.finishedAt,
      })),
      plan: sellfoxPlanSummary(),
      lastSuccess: Object.fromEntries(lastSuccess),
      runs: runs.slice(0, 20).map((run) => ({
        id: run.id, resource: run.resource, status: run.status, error: run.error,
        startedAt: run.startedAt, finishedAt: run.finishedAt,
        progress: (run.summary as { progress?: { count?: number } } | null)?.progress?.count ?? null,
        result: (run.summary as { result?: unknown } | null)?.result ?? null,
      })),
    });
  } catch (error) {
    console.error(JSON.stringify({ scope: "sellfox.hub", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ error: "读取赛狐数据总览失败，请稍后重试。" }, { status: 500 });
  }
}
