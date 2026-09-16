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
const workspacesCache = new Map<string, CachedResponse<WorkspacesResponse>>();
const workspacesInflight = new Map<string, Promise<WorkspacesResponse>>();
const teamAccountsCache = new Map<string, CachedResponse<TeamAccountsResponse>>();
const teamAccountsInflight = new Map<string, Promise<TeamAccountsResponse>>();

function getWorkspaceCacheKey() {
  return "workspaces";
}

function getTeamAccountsCacheKey() {
  return "team-accounts";
}

export function invalidateWorkspaceApiCache() {
  workspacesCache.clear();
  workspacesInflight.clear();
  teamAccountsCache.clear();
  teamAccountsInflight.clear();
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
    workspacesCache.set(cacheKey, { cachedAt: Date.now(), data: nextData });
    return nextData;
  })();

  workspacesInflight.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    workspacesInflight.delete(cacheKey);
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
      teamAccountsCache.set(cacheKey, { cachedAt: Date.now(), data: nextData });
      return nextData;
    }

    const data = (await response.json()) as { accounts?: unknown };
    const nextData = { accounts: normalizeTeamAccounts(data.accounts) };
    teamAccountsCache.set(cacheKey, { cachedAt: Date.now(), data: nextData });
    return nextData;
  })();

  teamAccountsInflight.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    teamAccountsInflight.delete(cacheKey);
  }
}
