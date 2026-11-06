import { prisma } from "@/lib/db/prisma";

export type SellfoxStoreFailure = { shopExternalId: string; shopName: string; error: string; runId: string; status: string };

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Latest run's per-store errors. A failed shop stays visible even when older snapshots remain. */
export async function sellfoxStoreSyncFailures(resource: "orders" | "fba_shipments", scope: { organizationId: string; workspaceId: string }) {
  const run = await prisma.sellfoxSyncRun.findFirst({
    where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, resource },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, error: true, summary: true },
  });
  if (!run) return [] as SellfoxStoreFailure[];
  const bucket = record(record(run.summary)?.progress)?.[resource];
  const failures: SellfoxStoreFailure[] = [];
  if (record(bucket)) {
    for (const [shopExternalId, state] of Object.entries(record(bucket)!)) {
      const error = record(state)?.error;
      if (typeof error === "string" && error) failures.push({ shopExternalId, shopName: "", error, runId: run.id, status: run.status });
    }
  }
  if (!failures.length && run.status === "failed" && run.error) failures.push({ shopExternalId: "", shopName: "", error: run.error, runId: run.id, status: run.status });
  const ids = failures.map((failure) => failure.shopExternalId).filter(Boolean);
  if (ids.length) {
    const stores = await prisma.sellfoxStore.findMany({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, externalId: { in: ids } },
      select: { externalId: true, name: true },
    });
    const names = new Map(stores.map((store) => [store.externalId, store.name]));
    for (const failure of failures) failure.shopName = names.get(failure.shopExternalId) ?? "";
  }
  return failures;
}
