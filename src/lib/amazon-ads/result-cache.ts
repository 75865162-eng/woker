/**
 * Amazon Ads read-through result cache.
 *
 * Mirrors the proven sellfox result-cache pattern, with one Amazon-specific
 * hard requirement: Amazon data access is resolved PER USER from live grants
 * (member ∪ role), not workspace-static like sellfox stores. Therefore every
 * cache key MUST carry an access fingerprint derived from the caller's CURRENT
 * AmazonDataAccess — otherwise user A could read user B's authorized rows.
 *
 * Scope & isolation:
 *  - keys are namespaced `amazon:` and carry org + workspace + access fingerprint
 *    + domain, so cross-tenant, cross-workspace and cross-grant reads never collide;
 *  - only READ-ONLY bodies may be cached. Callers MUST keep their own live
 *    authorization check and audit OUTSIDE/BEFORE this cache (see notes below);
 *  - a cached body is served only while its data version still matches, so an
 *    in-flight sync cannot leak stale rows.
 *
 * IMPORTANT — what this cache must NOT be used for:
 *  - Do not cache the final response of queryAmazonAdsData() as a substitute for
 *    its in-query TOCTOU re-check (query-service.ts:145-158) or its per-request
 *    audit (:159). Those are security/compliance gates and must still run on
 *    every request. Cache only permission-filtered pure data at a layer where
 *    the caller has already resolved access for THIS request.
 *  - Never derive the fingerprint from request-supplied seller IDs; only from
 *    the server-resolved AmazonDataAccess.
 *
 * Failure policy (fail-open): disabled by env, Redis unavailable, serialization
 * or version-read failure all degrade to a plain cache miss. A cache problem
 * must never 500 the page.
 *
 * Pure helpers are exported for unit tests and carry no IO/env.
 */
import { createHash } from "node:crypto";
import RedisClient from "ioredis";
import type { AmazonDataAccess } from "@/lib/amazon-sync/data-access";

export const AMAZON_CACHE_PREFIX = "amazon:";
export const AMAZON_DEFAULT_TTL = 120;
export const AMAZON_EMPTY_TTL = 30;
export const AMAZON_CACHE_TTL: Record<string, number> = {
  // 报表采集状态：worker 分钟级刷新，2 分钟 TTL 足够削峰。
  report_acquisition: 120,
  // Ads Profile/Seller 元数据：绑定变更低频，靠失效映射主动 DEL。
  ads_metadata: 300,
};

/** Canonical query normalization: sorted keys, arrays order-independent, empties dropped. */
export function normalizeAmazonCacheQuery(input: Record<string, unknown>): string {
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

/**
 * Stable fingerprint of a caller's CURRENT Amazon data access. Must be derived
 * from the server-resolved access object only. Two users with identical grants
 * share a fingerprint (safe); a revoked user gets a different one and can never
 * read the previous cached body. Returns "" for an invalid/absent access, which
 * makes readThroughAmazon bypass the cache entirely (fail-safe).
 */
export function amazonAccessFingerprint(access: AmazonDataAccess | undefined | null): string {
  if (!access) return "";
  if (access.allSellers) return sha256("all");
  const sellerIds = [...new Set(access.sellerIds)].sort();
  if (!sellerIds.length && !access.scopes?.length) return "";
  const scopes = (access.scopes ?? [])
    .map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceIds: [...new Set(s.marketplaceIds)].sort() }))
    .sort((a, b) => a.sellerAccountId.localeCompare(b.sellerAccountId));
  return sha256(JSON.stringify({ sellerIds, scopes }));
}

/**
 * Canonical cache key. `domain` and `accessFingerprint` are mandatory so one
 * domain or grant scope never reads another's body.
 */
export function amazonCacheKey(
  organizationId: string,
  workspaceId: string,
  domain: string,
  accessFingerprint: string,
  normalizedQuery: string,
): string {
  return `${AMAZON_CACHE_PREFIX}wb:${organizationId}:${workspaceId}:${domain}:${accessFingerprint || "INVALID"}:${sha256(normalizedQuery)}`;
}

export function amazonDomainInvalidationPrefix(organizationId: string, workspaceId: string, domain: string): string {
  return `${AMAZON_CACHE_PREFIX}wb:${organizationId}:${workspaceId}:${domain}:`;
}
export function amazonTenantInvalidationPrefix(organizationId: string, workspaceId: string): string {
  return `${AMAZON_CACHE_PREFIX}wb:${organizationId}:${workspaceId}:`;
}
function versionKeyOf(key: string) { return `${key}:v`; }

export type AmazonCachedBody<T> = { version: string; cachedAt: string; empty: boolean; body: T };

export function cacheEnabled(): boolean {
  return process.env.AMAZON_CACHE_ENABLED === "true";
}

export const AMAZON_TTL_JITTER_RATIO = 0.1;
export function ttlWithJitter(baseTtl: number, random: () => number = Math.random, ratio = AMAZON_TTL_JITTER_RATIO): number {
  if (!Number.isFinite(baseTtl) || baseTtl <= 0) return baseTtl;
  const r = Math.min(1, Math.max(0, random()));
  return Math.max(1, Math.round(baseTtl * (1 - ratio + 2 * ratio * r)));
}
function ttlFor(domain: string, random?: () => number) {
  const override = Number(process.env[`AMAZON_CACHE_TTL_${domain.toUpperCase()}`]);
  const base = Number.isFinite(override) && override > 0 ? override : (AMAZON_CACHE_TTL[domain] ?? AMAZON_DEFAULT_TTL);
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
      maxRetriesPerRequest: 1, commandTimeout: 300, connectTimeout: 500,
      retryStrategy: () => null, enableOfflineQueue: true,
    });
    redis.on("error", () => {});
  }
  return redis;
}

let injectedRedis: RedisLike | null | undefined;
export function setAmazonCacheRedisForTest(client: RedisLike | null | undefined) { injectedRedis = client; }
let ttlRandom: () => number = Math.random;
export function setAmazonTtlRandomForTest(random: (() => number) | undefined) { ttlRandom = random ?? Math.random; }
function client(): RedisLike | undefined {
  return injectedRedis !== undefined ? (injectedRedis ?? undefined) : getRedis();
}

function metric(event: "cacheHit" | "cacheMiss" | "cacheError" | "cacheBypass", domain: string, detail?: string) {
  console.info(JSON.stringify({ scope: "amazon.result-cache", event, domain, ...(detail ? { detail } : {}) }));
}

const inFlight = new Map<string, Promise<unknown>>();
function singleflight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const task = load().finally(() => { inFlight.delete(key); });
  inFlight.set(key, task);
  return task;
}

/**
 * Read through the cache. `loadVersion` returns the current data version;
 * `load` produces the body on a miss.
 *
 * SECURITY: `accessFingerprint` MUST come from amazonAccessFingerprint(serverResolvedAccess).
 * If it is empty/invalid, the cache is bypassed entirely (fail-safe) — never
 * fall back to an unscoped key. Callers are responsible for keeping their live
 * authorization + audit in the request path regardless of hit/miss.
 */
export async function readThroughAmazon<T>(
  key: string,
  domain: string,
  accessFingerprint: string,
  loadVersion: () => Promise<string>,
  load: () => Promise<T>,
  options: { bypass?: boolean; isEmpty?: (body: T) => boolean } = {},
): Promise<{ body: T; cache: "hit" | "miss" | "bypass"; cachedAt: string | null; version: string }> {
  if (options.bypass || !cacheEnabled() || !accessFingerprint) {
    if (!accessFingerprint && !options.bypass && cacheEnabled()) metric("cacheBypass", domain, "no-access-fingerprint");
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
          const cached = JSON.parse(raw) as AmazonCachedBody<T>;
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
        const ttl = empty ? AMAZON_EMPTY_TTL : ttlFor(domain, ttlRandom);
        const value: AmazonCachedBody<T> = { version: currentVersion, cachedAt, empty, body };
        await c.set(key, JSON.stringify(value), "EX", ttl);
        await c.set(versionKeyOf(key), currentVersion, "EX", ttl);
      } catch (error) {
        metric("cacheError", domain, error instanceof Error ? error.message.slice(0, 80) : "write");
      }
    }
    return { body, cache: "miss" as const, cachedAt: null, version: currentVersion };
  });
}

/** Invalidate every cached body (and version sentinel) for a domain/tenant. SCAN+DEL, never KEYS. */
export async function invalidateAmazonDomain(organizationId: string, workspaceId: string, domain: string): Promise<void> {
  if (!cacheEnabled()) return;
  const c = client();
  if (!c) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await c.scan(cursor, "MATCH", `${amazonDomainInvalidationPrefix(organizationId, workspaceId, domain)}*`, "COUNT", 200);
      cursor = next;
      const targets = keys.flatMap(key => [key, versionKeyOf(key)]);
      if (targets.length) await c.del(...targets);
    } while (cursor !== "0");
  } catch (error) {
    metric("cacheError", domain, error instanceof Error ? `invalidate:${error.message.slice(0, 60)}` : "invalidate");
  }
}

/** Invalidate all Amazon cache for a tenant (e.g. on any ads sync completion). */
export async function invalidateAmazonTenant(organizationId: string, workspaceId: string): Promise<void> {
  if (!cacheEnabled()) return;
  const c = client();
  if (!c) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await c.scan(cursor, "MATCH", `${amazonTenantInvalidationPrefix(organizationId, workspaceId)}*`, "COUNT", 200);
      cursor = next;
      const targets = keys.flatMap(key => [key, versionKeyOf(key)]);
      if (targets.length) await c.del(...targets);
    } while (cursor !== "0");
  } catch (error) {
    metric("cacheError", "tenant", error instanceof Error ? `invalidate:${error.message.slice(0, 60)}` : "invalidate");
  }
}
