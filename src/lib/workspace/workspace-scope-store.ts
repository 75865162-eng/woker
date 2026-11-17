"use client";

/**
 * 工作区作用域的唯一读取入口，唯一存储键为 `amazon_bulk_ad_workspace_scope`。
 * 服务端仍然叠加组织与权限边界。
 */
export const workspaceScopeStorageKey = "amazon_bulk_ad_workspace_scope";

export type SelectedWorkspaceScope = {
  workspaceId: string;
  accountId: string;
  marketplace: string;
};

function readScope(storageKey: string): SelectedWorkspaceScope | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const scope = parsed as Record<string, unknown>;
    const workspaceId = typeof scope.workspaceId === "string" ? scope.workspaceId.trim() : "";
    if (!workspaceId) return null;
    return {
      workspaceId,
      accountId: typeof scope.accountId === "string" ? scope.accountId.trim() : "",
      marketplace: typeof scope.marketplace === "string" ? scope.marketplace.trim() : "",
    };
  } catch {
    return null;
  }
}

export function readWorkspaceScope(): SelectedWorkspaceScope {
  return readScope(workspaceScopeStorageKey) ?? { workspaceId: "default", accountId: "", marketplace: "" };
}

export function readWorkspaceScopeId() {
  return readWorkspaceScope().workspaceId;
}

export function workspaceScopeHeaders(json = false) {
  const scope = readWorkspaceScope();
  const headers = new Headers({ "x-workspace-id": scope.workspaceId });
  if (scope.accountId) headers.set("x-account-id", scope.accountId);
  if (scope.marketplace) headers.set("x-marketplace", scope.marketplace);
  if (json) headers.set("content-type", "application/json");
  return headers;
}
