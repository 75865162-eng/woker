/**
 * Short-TTL in-process cache for the sellfox hub overview counters.
 *
 * The hub runs one count/max/distinct SQL per live dataset (12 today). Those
 * numbers change only when a sync finishes, so re-running them on every hub
 * open is wasteful. This cache holds only the pure statistics keyed by
 * org+workspace; live fields (lastRun status, href, plan) are always built
 * fresh by the caller. If any dataset read fails, nothing is cached so the
 * failed table is retried on the next request.
 */

type DatasetStat = {
  key: string;
  rows: number;
  latest: string | null;
  storesWithData: number;
};

type CachedValue = { cachedAt: number; stats: DatasetStat[] };
const cache = new Map<string, CachedValue>();
const TTL_MS = 45_000;
const MAX_ENTRIES = 64;

export function hubOverviewCacheKey(organizationId: string, workspaceId: string): string {
  return `${organizationId}:${workspaceId}`;
}

/** Drop stale entries and the oldest entries beyond the cap. */
function prune(now: number) {
  for (const [key, value] of cache) {
    if (now - value.cachedAt > TTL_MS) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Return cached dataset stats when fresh, otherwise compute via `compute()`.
 * `compute` returns stats including an optional `readError`; errored entries
 * are excluded from what gets cached, but still returned to the caller.
 */
export async function getHubDatasetStats(
  key: string,
  compute: () => Promise<Array<DatasetStat & { readError?: string | null }>>,
): Promise<Array<DatasetStat & { readError?: string | null }>> {
  const now = Date.now();
  prune(now);
  const hit = cache.get(key);
  if (hit && now - hit.cachedAt <= TTL_MS) {
    return hit.stats.map((stat) => ({ ...stat, readError: null }));
  }

  const stats = await compute();
  // If any dataset failed, cache nothing: the next request must retry all of
  // them so a temporarily unreadable table is not frozen into a stale result.
  if (stats.some((stat) => stat.readError)) return stats;
  const cacheable = stats.map(({ key, rows, latest, storesWithData }) => ({ key, rows, latest, storesWithData }));
  if (cacheable.length) cache.set(key, { cachedAt: Date.now(), stats: cacheable });
  return stats;
}

/** Invalidate after a sellfox sync finishes (done/failed) for a scope. */
export function invalidateHubOverview(organizationId: string, workspaceId: string): void {
  cache.delete(hubOverviewCacheKey(organizationId, workspaceId));
}

/** Test helper: clear all hub overview cache entries. */
export function clearHubOverviewCache(): void {
  cache.clear();
}
