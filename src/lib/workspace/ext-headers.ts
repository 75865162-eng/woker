"use client";

import { workspaceScopeHeaders } from "./workspace-scope-store";

export { readWorkspaceScopeId, workspaceScopeHeaders, workspaceScopeStorageKey } from "./workspace-scope-store";

/** `/api/*` 的请求头：带上当前工作区，服务端据此隔离数据。 */
export function extHeaders(json = false) {
  return workspaceScopeHeaders(json);
}
