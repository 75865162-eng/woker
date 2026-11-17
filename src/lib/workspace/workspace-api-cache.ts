"use client";

import { normalizeTeamAccounts, type TeamAccountRecord } from "@/lib/accounts/team-roster";

type WorkspaceScope = {
  id: string;
  name: string;
  accountId?: string | null;
  marketplace?: string | null;
  isDefault?: boolean;
  updatedAt?: string;
};

type CachedResponse<T> = {
  cachedAt: number;
  data: T;
};

type WorkspacesResponse = {
  workspaces: WorkspaceScope[];
};

type TeamAccountsResponse = {
  accounts: TeamAccountRecord[];
};

const REQUEST_CACHE_TTL_MS = 5000;
/** 查询结果缓存的条数上限，超出后淘汰最久未命中的键。 */
const QUERY_CACHE_LIMIT = 60;
const workspacesCache = new Map<string, CachedResponse<WorkspacesResponse>>();
const workspacesInflight = new Map<string, Promise<WorkspacesResponse>>();
const teamAccountsCache = new Map<string, CachedResponse<TeamAccountsResponse>>();
const teamAccountsInflight = new Map<string, Promise<TeamAccountsResponse>>();
const queryCache = new Map<string, CachedResponse<unknown>>();
let identityScope = "unbound";
let cacheGeneration = 0;

export function workspaceApiCacheToken() { return `${identityScope}:${cacheGeneration}`; }

function queryCacheKey(key: string) {
  return `${identityScope}:${cacheGeneration}:${key}`;
}

/** 读取快照：命中后把它移到队尾，实现 LRU。没有过期时间——调用方先出内容再后台校验。 */
export function readWorkspaceApiQuery<T>(key: string): CachedResponse<T> | null {
  const fullKey = queryCacheKey(key);
  const hit = queryCache.get(fullKey);
  if (!hit) return null;
  queryCache.delete(fullKey);
  queryCache.set(fullKey, hit);
  return hit as CachedResponse<T>;
}

export function writeWorkspaceApiQuery<T>(key: string, data: T) {
  const fullKey = queryCacheKey(key);
  queryCache.delete(fullKey);
  queryCache.set(fullKey, { cachedAt: Date.now(), data });
  while (queryCache.size > QUERY_CACHE_LIMIT) {
    const oldest = queryCache.keys().next();
    if (oldest.done) break;
    queryCache.delete(oldest.value);
  }
}

export function setWorkspaceApiCacheScope(scope: string) {
  if (scope === identityScope) return;
  identityScope = scope;
  invalidateWorkspaceApiCache();
}

function getWorkspaceCacheKey() {
  return `${identityScope}:${cacheGeneration}:workspaces`;
}

function getTeamAccountsCacheKey() {
  return `${identityScope}:${cacheGeneration}:team-accounts`;
}

export function invalidateWorkspaceApiCache() {
  cacheGeneration++;
  workspacesCache.clear();
  workspacesInflight.clear();
  teamAccountsCache.clear();
  teamAccountsInflight.clear();
  queryCache.clear();
  apiInflight.clear();
}

export async function fetchWorkspacesCached(options?: { signal?: AbortSignal; force?: boolean }) {
  const cacheKey = getWorkspaceCacheKey();
  const cached = workspacesCache.get(cacheKey);

  if (!options?.force && cached && Date.now() - cached.cachedAt < REQUEST_CACHE_TTL_MS) {
    return cached.data;
  }

  const inFlight = workspacesInflight.get(cacheKey);
  if (inFlight && !options?.force) {
    return inFlight;
  }

  const promise = (async () => {
    const response = await fetch("/api/workspaces", { cache: "no-store", signal: options?.signal });
    const data = (await response.json()) as { workspaces?: WorkspaceScope[]; error?: string };

    if (!response.ok) {
      throw new Error(data.error || "工作区读取失败。");
    }

    const nextData = { workspaces: Array.isArray(data.workspaces) ? data.workspaces : [] };
    if (cacheKey === getWorkspaceCacheKey()) workspacesCache.set(cacheKey, { cachedAt: Date.now(), data: nextData });
    return nextData;
  })();

  workspacesInflight.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    workspacesInflight.delete(cacheKey);
  }
}

export type CachedFetchOptions<T> = {
  /** Cache key; callers include scope + endpoint + serialized params (identity scope is prefixed automatically). */
  queryKey: string;
  ttlMs?: number;
  force?: boolean;
  fetcher: () => Promise<T>;
  /** Retries on fetcher failure; default 0. Retries share the same inflight promise. */
  retries?: number;
};

const apiInflight = new Map<string, Promise<unknown>>();

/**
 * Generic stale-while-revalidate style GET with TTL + in-flight de-duplication.
 * Built on the existing queryCache (identity scope + generation prefixed), not a
 * second cache system. Strongly-realtime data (running jobs/progress/export
 * status) and write operations must NOT use this — only read-only list/overview
 * endpoints. Cache lives in browser memory only (lost on refresh).
 */
export async function cachedApiGet<T>(options: CachedFetchOptions<T>): Promise<T> {
  const { queryKey, ttlMs = REQUEST_CACHE_TTL_MS, force = false, fetcher, retries = 0 } = options;
  const fullKey = queryCacheKey(queryKey);

  if (!force) {
    const hit = readWorkspaceApiQuery<T>(queryKey);
    if (hit && Date.now() - hit.cachedAt < ttlMs) return hit.data;
    const inFlight = apiInflight.get(fullKey);
    if (inFlight) return inFlight as Promise<T>;
  }

  const run = async (): Promise<T> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await fetcher();
        writeWorkspaceApiQuery(queryKey, data);
        return data;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };

  const promise = run();
  apiInflight.set(fullKey, promise);
  try {
    return await promise;
  } finally {
    if (apiInflight.get(fullKey) === promise) apiInflight.delete(fullKey);
  }
}

export async function saveWorkspaceScope(form: { workspaceId: string; name: string; accountId: string; marketplace: string }) {
  const response = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  const data = (await response.json()) as { workspace?: WorkspaceScope; error?: string };

  if (!response.ok || !data.workspace) {
    throw new Error(data.error || "工作区保存失败。");
  }

  invalidateWorkspaceApiCache();
  return data.workspace;
}

export async function fetchTeamAccountsCached(options?: { force?: boolean }) {
  const cacheKey = getTeamAccountsCacheKey();
  const cached = teamAccountsCache.get(cacheKey);

  if (!options?.force && cached && Date.now() - cached.cachedAt < REQUEST_CACHE_TTL_MS) {
    return cached.data;
  }

  const inFlight = teamAccountsInflight.get(cacheKey);
  if (inFlight && !options?.force) {
    return inFlight;
  }

  const promise = (async () => {
    const response = await fetch("/api/accounts/team-members");
    if (!response.ok) {
      const nextData = { accounts: [] };
      if (cacheKey === getTeamAccountsCacheKey()) teamAccountsCache.set(cacheKey, { cachedAt: Date.now(), data: nextData });
      return nextData;
    }

    const data = (await response.json()) as { accounts?: unknown };
    const nextData = { accounts: normalizeTeamAccounts(data.accounts) };
    if (cacheKey === getTeamAccountsCacheKey()) teamAccountsCache.set(cacheKey, { cachedAt: Date.now(), data: nextData });
    return nextData;
  })();

  teamAccountsInflight.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    teamAccountsInflight.delete(cacheKey);
  }
}
