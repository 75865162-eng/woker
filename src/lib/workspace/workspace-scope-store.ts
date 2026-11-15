"use client";

/**
 * 工作区作用域的唯一读取入口。
 *
 * 以前存在两套键：选择器写 `amazon_bulk_ad_workspace_scope`，而 `extHeaders`、
 * 草稿与若干个工作台读 `tiaotiao.workspace.scope`。后者从来没人写，于是这些地方
 * 恒等于 `default`——草稿因此被塞进 `default` 命名空间，切换工作区会把 A 的
 * 录入带进 B。这里统一成一个来源，服务端仍然叠加组织与权限边界。
 */
export const workspaceScopeStorageKey = "amazon_bulk_ad_workspace_scope";

/** 历史键：只在主键缺失时回退，避免升级后旧草稿凭空消失。 */
const legacyWorkspaceScopeStorageKey = "tiaotiao.workspace.scope";

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
  return readScope(workspaceScopeStorageKey) ?? readScope(legacyWorkspaceScopeStorageKey)
    ?? { workspaceId: "default", accountId: "", marketplace: "" };
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
