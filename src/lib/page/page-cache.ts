/**
 * 页面级客户端缓存。
 *
 * 对应 Wimoor 原系统的四层缓存里可迁移的两层：
 *  - Vuex dict / useUserStore 的字典与用户信息缓存 → 这里用 TTL Map + scope 失效
 *  - request.js cancelMap 的同 URL 请求取消 → 这里用 dedupeRequest 的 inflight 复用
 * keep-alive 与页签保活由 PersistentAppShell 的多标签 iframe 承担，不在这里重复。
 *
 * 与项目既有缓存的分工：
 *  - `@/lib/workspace/workspace-api-cache`（5s，工作区 API）保持不变
 *  - `@/lib/products/product-list-cache`（服务端 30s/60s + Prisma）保持不变
 *  - 本模块只服务于新统一页面基建的列表查询与页面概览
 */
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

export const PAGE_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 400;

type CacheEntry = { value: unknown; expiresAt: number; scope: string };
export type CacheStats = {
  hits: number;
  misses: number;
  size: number;
  lastUpdatedAt: number | null;
  scope: string;
};

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
let currentScope = "default";
let hits = 0;
let misses = 0;
let lastUpdatedAt: number | null = null;

function scopedKey(key: string): string {
  return `${currentScope}::${key}`;
}

function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

export function getPageCache<T>(key: string): T | null {
  const entry = store.get(scopedKey(key));
  if (!entry || entry.scope !== currentScope) {
    misses += 1;
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    store.delete(scopedKey(key));
    misses += 1;
    return null;
  }
  hits += 1;
  return entry.value as T;
}

export function setPageCache<T>(key: string, value: T, ttlMs: number = PAGE_CACHE_TTL_MS): void {
  store.set(scopedKey(key), { value, expiresAt: Date.now() + Math.max(0, ttlMs), scope: currentScope });
  lastUpdatedAt = Date.now();
  pruneExpired();
}

export function hasPageCache(key: string): boolean {
  const entry = store.get(scopedKey(key));
  return Boolean(entry && entry.scope === currentScope && entry.expiresAt > Date.now());
}

/** 传前缀只失效该前缀下的键；不传则清空全部（工作区切换时调用）。 */
export function invalidatePageCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  const fullPrefix = scopedKey(prefix);
  for (const key of store.keys()) {
    if (key.startsWith(fullPrefix)) store.delete(key);
  }
}

/** 作用域变化即清空缓存；供 AppShell 在组织/用户/角色变化时调用。 */
export function setPageCacheScope(scope: string): void {
  if (scope === currentScope) return;
  currentScope = scope;
  store.clear();
}

export function getPageCacheStats(): CacheStats {
  return { hits, misses, size: store.size, lastUpdatedAt, scope: currentScope };
}

/** 同 key 并发请求复用同一个 Promise，避免切 tab / 重复渲染打出重复请求。 */
export async function dedupeRequest<T>(key: string, run: () => Promise<T>): Promise<T> {
  const fullKey = scopedKey(key);
  const existing = inflight.get(fullKey);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => { inflight.delete(fullKey); });
  inflight.set(fullKey, promise as Promise<unknown>);
  return promise;
}

if (typeof window !== "undefined") {
  // 工作区/店铺/站点切换时主动失效，避免跨作用域展示旧数据。
  window.addEventListener(workspaceScopeChangedEventName, () => invalidatePageCache());
}
