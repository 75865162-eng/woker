/**
 * P1-4: cross-request Redis read-through cache for the organization role
 * permissions catalog (the authorization source of truth).
 *
 * Why this exists: `getOrganizationRoleCatalogSnapshot` already uses React
 * `cache()` (per-render only) — every HTTP request still re-reads the whole
 * role catalog from Postgres. On a 50-seat ERP that is one extra DB roundtrip
 * on every page render. This module adds an OPTIONAL cross-request cache.
 *
 * Safety design (authorization data — fail-closed where it matters):
 *  - opt-in only: `ROLE_PERMS_CACHE_ENABLED === "true"`, off by default;
 *  - version-checked: the cached body carries the catalog `revision` (derived
 *    from OrganizationRosterRole.updatedAt). On every read a LIGHT version
 *    query (id + updatedAt only, no permissions JSON) recomputes the revision;
 *    a mismatch is a miss. So a permission revoke is honored immediately even
 *    if the write-side DEL fails;
 *  - write-side invalidation: the two catalog write paths DEL the key on success;
 *  - fail-open on Redis error: any cache problem degrades to a direct DB read —
 *    a cache outage must never lock everyone out or 500 the page;
 *  - fail-closed preserved: DB-unavailable still returns minimal permissions via
 *    the existing loader (this module never fabricates permissions).
 *
 * Pure helpers are exported for unit tests and carry no IO/env.
 */
import { createHash } from "node:crypto";
import RedisClient from "ioredis";

export const ROLE_PERMS_CACHE_PREFIX = "roleperms:v1:";
export const ROLE_PERMS_CACHE_TTL_SECONDS = 60;

export function rolePermsCacheKey(organizationId: string): string {
  return `${ROLE_PERMS_CACHE_PREFIX}${createHash("sha256").update(organizationId).digest("hex").slice(0, 24)}`;
}

export function cacheEnabled(): boolean {
  return process.env.ROLE_PERMS_CACHE_ENABLED === "true";
}

/** Cached body shape. `revision` is compared against the light version query. */
export type CachedRolePerms<T> = { revision: string; cachedAt: string; body: T };

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
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
      enableOfflineQueue: true,
    });
    redis.on("error", () => {});
  }
  return redis;
}

/** Test seam: inject a Redis-like client (or null to simulate outage). */
let injectedRedis: RedisLike | null | undefined;
export function setRolePermsCacheRedisForTest(client: RedisLike | null | undefined) {
  injectedRedis = client;
}
function client(): RedisLike | undefined {
  return injectedRedis !== undefined ? (injectedRedis ?? undefined) : getRedis();
}

function metric(event: "hit" | "miss" | "error", detail?: string) {
  console.info(JSON.stringify({ scope: "roleperms.cache", event, ...(detail ? { detail } : {}) }));
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

export type ReadThroughResult<T> = { body: T; cache: "hit" | "miss" | "bypass"; cachedAt: string | null; revision: string };

/**
 * Read a versioned snapshot through the cache.
 * `loadVersion` must be a LIGHT query returning the current revision string.
 * `load` produces the full body on a miss. Any cache failure degrades to load().
 */
export async function readThroughRolePerms<T>(
  organizationId: string,
  loadVersion: () => Promise<string>,
  load: () => Promise<{ body: T; revision: string }>,
): Promise<ReadThroughResult<T>> {
  if (!cacheEnabled()) {
    const result = await load();
    return { body: result.body, cache: "bypass", cachedAt: null, revision: result.revision };
  }
  return singleflight(rolePermsCacheKey(organizationId), async () => {
    let currentRevision = "";
    try { currentRevision = await loadVersion(); } catch { /* version read failure → miss */ }
    const c = client();
    if (c && currentRevision) {
      try {
        const raw = await c.get(rolePermsCacheKey(organizationId));
        if (raw) {
          const cached = JSON.parse(raw) as CachedRolePerms<T>;
          if (cached.revision === currentRevision) {
            metric("hit");
            return { body: cached.body, cache: "hit" as const, cachedAt: cached.cachedAt, revision: cached.revision };
          }
        }
      } catch (error) {
        metric("error", error instanceof Error ? error.message.slice(0, 80) : "read");
      }
    }
    metric("miss");
    const result = await load();
    const cachedAt = new Date().toISOString();
    // Store the authoritative revision from the full loader (seed can make the
    // light version query momentarily disagree); future reads recheck via the
    // light query, which converges once the seeded rows exist.
    const revisionToStore = result.revision || currentRevision;
    if (c && revisionToStore) {
      try {
        const value: CachedRolePerms<T> = { revision: revisionToStore, cachedAt, body: result.body };
        await c.set(rolePermsCacheKey(organizationId), JSON.stringify(value), "EX", ROLE_PERMS_CACHE_TTL_SECONDS);
      } catch (error) {
        metric("error", error instanceof Error ? error.message.slice(0, 80) : "write");
      }
    }
    return { body: result.body, cache: "miss" as const, cachedAt: null, revision: result.revision };
  });
}

/** Invalidate the cached catalog after a successful write. Failures swallowed by design. */
export async function invalidateRolePerms(organizationId: string): Promise<void> {
  if (!cacheEnabled()) return;
  const c = client();
  if (!c) return;
  try {
    await c.del(rolePermsCacheKey(organizationId));
  } catch (error) {
    metric("error", error instanceof Error ? `invalidate:${error.message.slice(0, 60)}` : "invalidate");
  }
}
