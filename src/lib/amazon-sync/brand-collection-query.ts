import { nextAutomaticBrandPolicy } from "./automatic-brand";
import type { Prisma } from "@prisma/client";
import { brandCollectionWindows, brandTaskPolicy, brandWindowKey } from "./brand-collection";
import { parseObservationPolicy, type AnalyticsPolicy } from "./observation-policy";
import { SyncInputError, type SyncScope } from "./policy";

/** Existing PostgreSQL source policy is the approved finite manifest; successful
 * tasks are its durable checkpoints. Redis never owns coverage. */
export async function readBrandCollection(tx: Prisma.TransactionClient, scope: SyncScope, source: { id: string; revision: number; authorizationId: string; authorization: { revision: number }; domainPolicy: unknown }) {
  const policy = parseObservationPolicy(source.domainPolicy, "brand_analytics") as AnalyticsPolicy;
  if (!policy.collection) return null;
  const windows = brandCollectionWindows(policy.collection);
  const runs = await tx.amazonSyncRun.findMany({
    where: { ...scope, sourceId: source.id, resource: "brand_analytics", executionVersion: 2, stage: { not: "PURGED" }, AND: [
      { frozenScope: { path: ["sourceRevision"], equals: source.revision } },
      { frozenScope: { path: ["authorizationRevision"], equals: source.authorization.revision } },
      { frozenScope: { path: ["authorizationId"], equals: source.authorizationId } },
    ] },
    select: { id: true, status: true, error: true, frozenScope: true, finishedAt: true, processedCount: true },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 4001,
  });
  if (runs.length > 4000) throw new SyncInputError("品牌历史任务超出本次回补容量，须缩小范围后审阅。", 409);
  const byKey = new Map<string, typeof runs[number]>();
  for (const run of runs) {
    try {
      const frozen = run.frozenScope as { domainPolicy?: unknown };
      const p = parseObservationPolicy(frozen.domainPolicy, "brand_analytics") as AnalyticsPolicy;
      const key = brandWindowKey(p), prior = byKey.get(key);
      if (!prior || run.status === "SUCCEEDED" && run.finishedAt && prior.status !== "SUCCEEDED") byKey.set(key, run);
    } catch { /* Historical malformed task cannot prove coverage. */ }
  }
  const items = windows.map(window => {
    const run = byKey.get(brandWindowKey(window));
    const succeeded = run?.status === "SUCCEEDED" && !!run.finishedAt;
    return { ...window, key: brandWindowKey(window), taskId: run?.id ?? null, status: succeeded ? run!.processedCount === 0 ? "EMPTY" : "SUCCEEDED" : run?.status ?? "MISSING", error: run?.error ?? null, rows: succeeded ? run!.processedCount : null };
  });
  const completed = items.filter(i => ["SUCCEEDED", "EMPTY"].includes(i.status)).length;
  return { policy, items, total: items.length, completed, complete: completed === items.length,
    // Keep failed/uncertain windows uncovered and preserve their task IDs.
    // Other report kinds and periods can proceed without replaying their creates.
    next: items.find(i => i.status === "MISSING") ?? null };
}
export async function nextBrandCollectionPolicy(tx: Prisma.TransactionClient, scope: SyncScope, source: Parameters<typeof readBrandCollection>[2]): Promise<AnalyticsPolicy> {
  const collection = await readBrandCollection(tx, scope, source);
  if (!collection) {
    const policy = parseObservationPolicy(source.domainPolicy, "brand_analytics") as AnalyticsPolicy;
    return policy.automaticDiscovery ? nextAutomaticBrandPolicy(tx, scope, source.id, policy) : policy;
  }
  if (!collection.next) throw new SyncInputError(collection.complete ? "品牌回补清单已全部完成。" : "品牌清单其余窗口尚未完成，等待原任务恢复；没有新的可执行窗口。", 409);
  if (collection.next.status !== "MISSING") throw new SyncInputError("品牌回补已有未完成或失败任务，请从原任务检查点恢复。", 409);
  return brandTaskPolicy(collection.policy, collection.next);
}
