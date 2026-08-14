"use client";

import { defaultWorkspaceScope, normalizeWorkspaceScope, type WorkspaceScopeInput } from "@/lib/workspace/scope";

export const workspaceScopeStorageKey = "amazon_bulk_ad_workspace_scope";

export function readSelectedWorkspaceScope(): WorkspaceScopeInput {
  if (typeof window === "undefined") {
    return defaultWorkspaceScope;
  }

  try {
    return normalizeWorkspaceScope(JSON.parse(window.localStorage.getItem(workspaceScopeStorageKey) ?? "{}"));
  } catch {
    return defaultWorkspaceScope;
  }
}

export function writeSelectedWorkspaceScope(scope: WorkspaceScopeInput) {
  window.localStorage.setItem(workspaceScopeStorageKey, JSON.stringify(normalizeWorkspaceScope(scope)));
}

export function addWorkspaceScopeToFormData(formData: FormData, scope = readSelectedWorkspaceScope()) {
  formData.set("workspaceId", scope.workspaceId);
  formData.set("accountId", scope.accountId);
  formData.set("marketplace", scope.marketplace);
  return formData;
}

export function scopedApiPath(path: string) {
  const scope = readSelectedWorkspaceScope();
  const url = new URL(path, window.location.origin);

  url.searchParams.set("workspaceId", scope.workspaceId);
  if (scope.accountId) url.searchParams.set("accountId", scope.accountId);
  if (scope.marketplace) url.searchParams.set("marketplace", scope.marketplace);

  return `${url.pathname}${url.search}`;
}

export function scopedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const scope = readSelectedWorkspaceScope();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

  headers.set("x-workspace-id", scope.workspaceId);
  if (scope.accountId) headers.set("x-account-id", scope.accountId);
  if (scope.marketplace) headers.set("x-marketplace", scope.marketplace);

  return fetch(input, { ...init, headers });
}
