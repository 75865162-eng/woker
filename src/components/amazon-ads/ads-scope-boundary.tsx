"use client";

import { Fragment, useCallback, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { readWorkspaceScope } from "@/lib/workspace/workspace-scope-store";

let lastScope = "";
let generation = 0;
function scopeSnapshot() {
  const { workspaceId, accountId, marketplace } = readWorkspaceScope();
  const scope = JSON.stringify([workspaceId, accountId, marketplace]);
  if (scope !== lastScope) { lastScope = scope; generation++; }
  return JSON.stringify([scope, generation]);
}
function subscribe(notify: () => void) {
  const changed = () => { scopeSnapshot(); notify(); };
  window.addEventListener(workspaceScopeChangedEventName, changed);
  return () => window.removeEventListener(workspaceScopeChangedEventName, changed);
}
const serverSnapshot = () => null;

export function AdsScopeBoundary({ children }: { children: ReactNode }) {
  const user = useAppShellUser();
  const scope = useSyncExternalStore(subscribe, scopeSnapshot, serverSnapshot);
  // 服务端与首次水合不挂载业务体，避免默认 scope 与实际 scope 各发一次请求。
  if (scope === null) return null;
  return <Fragment key={JSON.stringify([user?.organizationId, user?.userId, scope])}>{children}</Fragment>;
}

export function useAdsScopeCurrent() {
  const scope = scopeSnapshot();
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  // 已发送的业务请求无法撤回；仅阻止旧实例继续请求、跳转或推进操作序列。
  return useCallback(() => active.current && scope === scopeSnapshot(), [scope]);
}
