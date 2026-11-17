import Redis from "ioredis";
import { createHash } from "node:crypto";
import type { RolePermissionMap } from "@/lib/accounts/permissions";
import { cloneRolePermissionMap } from "@/lib/accounts/role-permissions-utils";

/**
 * Cross-request cache for the role → permissions map used by the non-transaction
 * authorization hot path. NOT a cache of membership status (which is bound to
 * the session and always read live).
 *
 * Layers: process-local LRU (≤32 entries, 45s) → optional Redis (45s) → onMiss DB.
 * Any cache failure degrades to onMiss; authorization itself stays fail-closed.
 * Never caches transaction-client reads — callers must only use this when
 * reading from the global prisma client.
 */

const TTL_MS = 45_000;
const MAX_ENTRIES = 32;
const KEY_PREFIX = "auth:role-perm:";

type CachedValue = { permissions: RolePermissionMap; cachedAt: number };

type CacheEntry = CachedValue & { expiresAt: number };
const processCache = new Map<string, CacheEntry>();

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function readProcess(orgId: string): RolePermissionMap | undefined {
  const entry = processCache.get(orgId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    processCache.delete(orgId);
    return undefined;
  }
  return entry.permissions;
}

function writeProcess(orgId: string, permissions: RolePermissionMap) {
  if (processCache.has(orgId)) processCache.delete(orgId);
  processCache.set(orgId, { permissions: cloneRolePermissionMap(permissions), cachedAt: Date.now(), expiresAt: Date.now() + TTL_MS });
  while (processCache.size > MAX_ENTRIES) {
    const oldest = processCache.keys().next().value;
    if (oldest === undefined) break;
    processCache.delete(oldest);
  }
}

export function invalidateOrganizationRolePermissions(orgId: string): void {
  processCache.delete(orgId);
  const client = getRedis();
  if (client) void client.del(KEY_PREFIX + digest(orgId)).catch(() => undefined);
}

let redis: InstanceType<typeof Redis> | undefined;
let injectedRedis: InstanceType<typeof Redis> | null | undefined;
export function setRolePermissionCacheRedisForTest(client: InstanceType<typeof Redis> | null | undefined) {
  injectedRedis = client;
}

function getRedis() {
  if (injectedRedis !== undefined) return injectedRedis ?? undefined;
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  if (!redis) {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      commandTimeout: 500,
      connectTimeout: 1000,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    redis.on("error", () => {});
  }
  return redis;
}

async function readRedis(client: InstanceType<typeof Redis>, orgId: string): Promise<RolePermissionMap | undefined> {
  const raw = await client.get(KEY_PREFIX + digest(orgId));
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as CachedValue;
  if (!parsed || typeof parsed.cachedAt !== "number" || Date.now() - parsed.cachedAt > TTL_MS || !parsed.permissions || typeof parsed.permissions !== "object") return undefined;
  return parsed.permissions;
}

async function writeRedis(client: InstanceType<typeof Redis>, orgId: string, permissions: RolePermissionMap) {
  const payload: CachedValue = { permissions, cachedAt: Date.now() };
  await client.set(KEY_PREFIX + digest(orgId), JSON.stringify(payload), "PX", TTL_MS);
}

export async function getOrganizationRolePermissionsCached(
  organizationId: string,
  onMiss: () => Promise<RolePermissionMap>,
): Promise<RolePermissionMap> {
  const local = readProcess(organizationId);
  if (local) return local;

  const client = getRedis();
  if (client) {
    try {
      const remote = await readRedis(client, organizationId);
      if (remote) {
        writeProcess(organizationId, remote);
        return remote;
      }
    } catch { /* Redis unavailable — fall through to source. */ }
  }

  const fresh = await onMiss();
  writeProcess(organizationId, fresh);
  if (client) {
    try { await writeRedis(client, organizationId, fresh); } catch { /* best effort */ }
  }
  return fresh;
}
