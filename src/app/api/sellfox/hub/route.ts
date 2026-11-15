import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getSellfoxCredentialStatus } from "@/lib/sellfox/credential-store";
import { sellfoxLiveDatasets, sellfoxPlanSummary } from "@/lib/sellfox/data-plan";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

type Counter = { n: bigint; latest: string | null; stores: bigint };

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;
    const organizationId = permission.user.organizationId;
    const workspaceId = workspaceScopeFromRequest(request).workspaceId;
    const where = { organizationId, workspaceId };

    const [credential, stores, runs, heartbeat] = await Promise.all([
      getSellfoxCredentialStatus(where),
      prisma.sellfoxStore.findMany({ where, select: { externalId: true, name: true, marketplace: true, country: true, status: true, lastSyncedAt: true }, orderBy: { name: "asc" } }),
      prisma.sellfoxSyncRun.findMany({ where, orderBy: { startedAt: "desc" }, take: 40, select: { id: true, resource: true, status: true, error: true, summary: true, startedAt: true, finishedAt: true } }),
      prisma.workerHeartbeat.findFirst({ where: { queueName: "sellfox-sync-jobs", status: "online", lastSeenAt: { gte: new Date(Date.now() - 90_000) } }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
    ]);

    const datasets = await Promise.all(sellfoxLiveDatasets.map(async (dataset) => {
      const lastRun = runs.find((run) => run.resource === dataset.resource) ?? null;
      const base = {
        key: dataset.key, label: dataset.label, resource: dataset.resource, table: dataset.table, href: dataset.href ?? null,
        lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, error: lastRun.error } : null,
      };
      try {
        // table / column names come from a static allow-list in data-plan.ts, values stay parameterized.
        const [counter] = await prisma.$queryRawUnsafe<Counter[]>(
          `select count(*)::bigint as n, max("${dataset.dateField}"::text) as latest, count(distinct "storeId")::bigint as stores from "${dataset.table}" where "organizationId" = $1 and "workspaceId" = $2`,
          organizationId, workspaceId,
        );
        return { ...base, rows: Number(counter?.n ?? 0), latest: counter?.latest ?? null, storesWithData: Number(counter?.stores ?? 0), readError: null };
      } catch {
        // One unreadable snapshot table must not blank the whole hub.
        return { ...base, rows: 0, latest: null, storesWithData: 0, readError: "该表统计读取失败" };
      }
    }));

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
