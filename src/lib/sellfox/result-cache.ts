/**
 * Sellfox read-through result cache (P0 of the slow-query remediation).
 *
 * Scope & isolation:
 *  - every key is namespaced `sellfox:` and carries organization + workspace,
 *    so it can never collide with Amazon or another tenant (物理/逻辑隔离);
 *  - only read-only workbench/snapshot responses are cached. Exports and write
 *    paths bypass this module entirely (caller passes `bypass`);
 *  - a cached body is only served when its data version still matches the
 *    current snapshot version, so an in-flight sync cannot leak stale rows.
 *
 * Failure policy (fail-open):
 *  - disabled by env, Redis unavailable, serialization error or version read
 *    failure all degrade to a plain cache miss. The caller then queries the
 *    database directly. A cache problem must never 500 the page.
 *
 * Pure helpers at the top are exported for unit tests and carry no IO/env.
 */
import { createHash } from "node:crypto";
import RedisClient from "ioredis";

/** Workbench domains that share the heavy CTE and their TTL (seconds). */
export const SELLFOX_CACHE_TTL: Record<string, number> = {
  sales: 300,
  performance: 300,
  listings: 300,
  ads_report: 600,
  ads_targeting: 600,
  ads_search_term: 600,
  ads_campaign: 600,
  ads_ad_group: 600,
  ads_placement: 600,
  // 补货建议是全量重查询：listing + 30 天销量 + 库存快照 + 在途，单次可达数十秒。
  // 依赖的快照每日/每 3 小时同步一次，无需秒级实时；按数据版本失效，保证一致性。
  restock: 300,
  overview: 60,
};
export const SELLFOX_DEFAULT_TTL = 300;
export const SELLFOX_EMPTY_TTL = 30;
export const SELLFOX_CACHE_PREFIX = "sellfox:";

/** Snapshot version source per domain (Prisma model + timestamp column). */
export const SELLFOX_VERSION_SOURCE: Record<string, { model: string; column: string }> = {
  sales: { model: "SellfoxSalesDailySnapshot", column: "syncedAt" },
  performance: { model: "SellfoxProductDailySnapshot", column: "syncedAt" },
  listings: { model: "SellfoxListingSnapshot", column: "capturedAt" },
  ads_report: { model: "SellfoxAdsProductDaily", column: "syncedAt" },
  ads_targeting: { model: "SellfoxAdsTargetingDaily", column: "syncedAt" },
  ads_search_term: { model: "SellfoxAdsSearchTermDaily", column: "syncedAt" },
  ads_campaign: { model: "SellfoxAdsCampaignDaily", column: "syncedAt" },
  ads_ad_group: { model: "SellfoxAdsAdGroupDaily", column: "syncedAt" },
  ads_placement: { model: "SellfoxAdsPlacementDaily", column: "syncedAt" },
  // 补货对 FBA 库存快照最敏感（同步最频繁，180 分钟）；其余输入（listing/销量/在途）
  // 分别由各自的失效映射覆盖，任一变化都会 DEL restock 缓存，无需复合版本。
  restock: { model: "SellfoxFbaInventorySnapshot", column: "capturedAt" },
};

/**
 * Normalize a query object into a stable string. Keys are sorted, empty/undefined
 * values dropped, and arrays preserved in order (they are filter selections).
 * This is the single source of truth for both the key hash and the client key.
 */
export function normalizeSellfoxCacheQuery(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      const items = value.map(item => String(item)).filter(Boolean).sort();
      if (items.length) parts.push(`${key}=[${items.join(",")}]`);
      continue;
    }
    if (typeof value === "object") {
      parts.push(`${key}=${JSON.stringify(value)}`);
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }
  return parts.join("&");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Canonical cache key. Domain is included so one domain never reads another's body. */
export function sellfoxCacheKey(
  organizationId: string,
  workspaceId: string,
  domain: string,
  normalizedQuery: string,
): string {
  return `${SELLFOX_CACHE_PREFIX}wb:${organizationId}:${workspaceId}:${domain}:${sha256(normalizedQuery)}`;
}
export function sellfoxOverviewCacheKey(organizationId: string, workspaceId: string, scopeKey: string): string {
  return `${SELLFOX_CACHE_PREFIX}ov:${organizationId}:${workspaceId}:${sha256(scopeKey)}`;
}
/**
 * Map a user's authorized sellfox store ids into the pieces the overview reader
 * needs. Three states MUST stay distinct or users share cache/prisma scope:
 *  - undefined (admin / scoping not enabled): full workspace, legacy key;
 *  - [] (scoping enabled, no grants): forced empty set,哨兵 key;
 *  - concrete ids: that subset only.
 */
export function overviewStoreScopeParts(authorizedStoreIds: string[] | undefined): {
  storeKeyPart: string[];
  storeWhere: Record<string, unknown>;
  storeTableWhere: Record<string, unknown>;
  restrict: boolean;
} {
  if (authorizedStoreIds === undefined) {
    return { storeKeyPart: [], storeWhere: {}, storeTableWhere: {}, restrict: false };
  }
  const ids = [...authorizedStoreIds].sort();
  const nonEmpty = ids.length > 0;
  return {
    storeKeyPart: nonEmpty ? ids : ["__NO_SELLFOX_STORE__"],
    storeWhere: { storeId: { in: ids } },
    storeTableWhere: { id: { in: ids } },
    restrict: true,
  };
}
/** Prefix used to invalidate every cached body/version for a domain in one tenant. */
export function sellfoxDomainInvalidationPrefix(organizationId: string, workspaceId: string, domain: string): string {
  return `${SELLFOX_CACHE_PREFIX}wb:${organizationId}:${workspaceId}:${domain}:`;
}
export function sellfoxOverviewInvalidationPrefix(organizationId: string, workspaceId: string): string {
  return `${SELLFOX_CACHE_PREFIX}ov:${organizationId}:${workspaceId}:`;
}
function versionKeyOf(key: string) { return `${key}:v`; }

export type CachedBody<T> = { version: string; cachedAt: string; empty: boolean; body: T };

export function cacheEnabled(): boolean {
  return process.env.SELLFOX_CACHE_ENABLED === "true";
}

/**
 * Cache-avalanche protection: spread expiry by ±JITTER_RATIO around the base TTL
 * so keys written in the same sync burst do not all expire at the same instant.
 * Pure and deterministic given `random`; the caller injects Math.random by default,
 * tests inject a fixed value. Bounds are clamped to >= 1 second.
 */
export const SELLFOX_TTL_JITTER_RATIO = 0.1;
export function ttlWithJitter(
  baseTtl: number,
  random: () => number = Math.random,
  ratio: number = SELLFOX_TTL_JITTER_RATIO,
): number {
  if (!Number.isFinite(baseTtl) || baseTtl <= 0) return baseTtl;
  const r = Math.min(1, Math.max(0, random()));
  return Math.max(1, Math.round(baseTtl * (1 - ratio + 2 * ratio * r)));
}
function ttlFor(domain: string, random?: () => number) {
  const override = Number(process.env[`SELLFOX_CACHE_TTL_${domain.toUpperCase()}`]);
  const base = Number.isFinite(override) && override > 0 ? override : (SELLFOX_CACHE_TTL[domain] ?? SELLFOX_DEFAULT_TTL);
  return random ? ttlWithJitter(base, random) : base;
}

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  scan(cursor: string, matchArg: string, pattern: string, countArg: string, count: number): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
  on(event: string, listener: () => void): void;
};

const Redis = RedisClient as unknown as new (url: string, options: Record<string, unknown>) => RedisLike;
let redis: RedisLike | undefined;
function getRedis(): RedisLike | undefined {
  if (!cacheEnabled()) return undefined;
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  if (!redis) {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      commandTimeout: 300,
      connectTimeout: 500,
      retryStrategy: () => null,
      // 允许命令在连接就绪前短暂排队（配合 commandTimeout 兜底），否则同步
      // 进程首次触发失效时会因 Stream 未就绪而失败，缓存残留到 TTL 过期。
      enableOfflineQueue: true,
    });
    redis.on("error", () => {});
  }
  return redis;
}

/** Test seam: inject a Redis-like client (or null to simulate outage). */
let injectedRedis: RedisLike | null | undefined;
export function setSellfoxCacheRedisForTest(client: RedisLike | null | undefined) {
  injectedRedis = client;
}

/** Test seam: inject the TTL jitter random source (default Math.random). */
let ttlRandom: () => number = Math.random;
export function setSellfoxTtlRandomForTest(random: (() => number) | undefined) {
  ttlRandom = random ?? Math.random;
}
function client(): RedisLike | undefined {
  return injectedRedis !== undefined ? (injectedRedis ?? undefined) : getRedis();
}

function metric(event: "cacheHit" | "cacheMiss" | "cacheError", domain: string, detail?: string) {
  console.info(JSON.stringify({ scope: "sellfox.result-cache", event, domain, ...(detail ? { detail } : {}) }));
}

/** Process-local singleflight: concurrent callers with the same key share one fetch. */
const inFlight = new Map<string, Promise<unknown>>();
function singleflight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const task = load().finally(() => { inFlight.delete(key); });
  inFlight.set(key, task);
  return task;
}

/**
 * Read through the cache. `loadVersion` returns the current snapshot version
 * string; `load` produces the body on a miss. Any cache failure degrades to a
 * direct load. `bypass` skips both read and write (used by exports/refresh).
 */
export async function readThroughSellfox<T>(
  key: string,
  domain: string,
  loadVersion: () => Promise<string>,
  load: () => Promise<T>,
  options: { bypass?: boolean; isEmpty?: (body: T) => boolean } = {},
): Promise<{ body: T; cache: "hit" | "miss" | "bypass"; cachedAt: string | null; version: string }> {
  if (options.bypass || !cacheEnabled()) {
    const body = await load();
    return { body, cache: "bypass", cachedAt: null, version: "" };
  }
  return singleflight(key, async () => {
    let currentVersion = "";
    try { currentVersion = await loadVersion(); } catch { /* version read failure → miss */ }
    const c = client();
    if (c && currentVersion) {
      try {
        const raw = await c.get(key);
        if (raw) {
          const cached = JSON.parse(raw) as CachedBody<T>;
          if (cached.version === currentVersion) {
            metric("cacheHit", domain);
            return { body: cached.body, cache: "hit" as const, cachedAt: cached.cachedAt, version: cached.version };
          }
        }
      } catch (error) {
        metric("cacheError", domain, error instanceof Error ? error.message.slice(0, 80) : "read");
      }
    }
    metric("cacheMiss", domain);
    const body = await load();
    const cachedAt = new Date().toISOString();
    if (c && currentVersion) {
      try {
        const empty = options.isEmpty ? options.isEmpty(body) : false;
        const ttl = empty ? SELLFOX_EMPTY_TTL : ttlFor(domain, ttlRandom);
        const value: CachedBody<T> = { version: currentVersion, cachedAt, empty, body };
        await c.set(key, JSON.stringify(value), "EX", ttl);
        // Store the version alongside for observability; expiry matches the body.
        await c.set(versionKeyOf(key), currentVersion, "EX", ttl);
      } catch (error) {
        metric("cacheError", domain, error instanceof Error ? error.message.slice(0, 80) : "write");
      }
    }
    return { body, cache: "miss" as const, cachedAt: null, version: currentVersion };
  });
}

/**
 * Invalidate all cached bodies (and version sentinels) for a domain/tenant.
 * Uses SCAN + batched DEL so it never blocks Redis with a large KEYS command.
 * Exposed for the sync-success hook. Failures are swallowed by design.
 */
export async function invalidateSellfoxDomain(
  organizationId: string,
  workspaceId: string,
  domain: string,
): Promise<void> {
  if (!cacheEnabled()) return;
  const c = client();
  if (!c) return;
  const prefixes = [sellfoxDomainInvalidationPrefix(organizationId, workspaceId, domain)];
  if (domain === "overview") prefixes.push(sellfoxOverviewInvalidationPrefix(organizationId, workspaceId));
  try {
    for (const prefix of prefixes) {
      let cursor = "0";
      do {
        const [next, keys] = await c.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
        cursor = next;
        const targets = keys.flatMap(key => [key, versionKeyOf(key)]);
        if (targets.length) await c.del(...targets);
      } while (cursor !== "0");
    }
  } catch (error) {
    metric("cacheError", domain, error instanceof Error ? `invalidate:${error.message.slice(0, 60)}` : "invalidate");
  }
}

/** Invalidate all workbench domains affected by one sync resource. */
export async function invalidateSellfoxSyncResource(
  organizationId: string,
  workspaceId: string,
  resource: string,
): Promise<void> {
  const affected = syncResourceToCacheDomains(resource);
  for (const domain of affected) await invalidateSellfoxDomain(organizationId, workspaceId, domain);
}

/** Pure mapping: which read-cache domains become stale after a sync resource succeeds. */
export function syncResourceToCacheDomains(resource: string): string[] {
  // 补货建议依赖库存 + listing + 销量 + 在途货件，任一变化都必须让其缓存失效。
  if (resource === "stores") return ["overview", "sales", "performance", "listings", "ads_report", "restock"];
  if (resource === "sales") return ["overview", "sales", "restock"];
  if (resource === "performance") return ["overview", "performance"];
  if (resource === "inventory") return ["overview", "sales", "performance", "listings", "restock"];
  if (resource === "listings") return ["sales", "performance", "listings", "ads_report", "restock"];
  if (resource === "fba_shipments") return ["restock"];
  if (resource === "order_detail") return ["restock"];
  if (resource === "hourly") return ["overview"];
  if (resource.startsWith("ads_")) return [resource, "overview"];
  return ["overview"];
}
