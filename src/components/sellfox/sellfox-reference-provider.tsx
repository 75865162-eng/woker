"use client";

/**
 * 赛狐引用数据 Provider：挂在 /sellfox layout，进入赛狐模块后台加载一次，
 * 所有子页共享同一 store 实例（店铺/站点/业务员内存直读，零请求、零 spinner）。
 *
 * 触发重载：
 * - workspace scope 变化（workspaceScopeChanged 事件）；
 * - 标签回前台且数据超过 revalidate 阈值（补同步后前端不知情的缺口，不引入 SSE/WS）。
 * 渲染策略：children 始终渲染，provider 不阻塞首屏。
 */
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { useSellfoxReferenceStore, referenceScopeKey } from "@/lib/stores/sellfox-reference-store";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { workspaceScopeFromUrl, defaultWorkspaceScope } from "@/lib/workspace/scope";

const REVALIDATE_MS = 60_000;

export function SellfoxReferenceProvider({ children }: { children: ReactNode }) {
  const user = useAppShellUser();
  const ensureLoaded = useSellfoxReferenceStore((s) => s.ensureLoaded);
  const refresh = useSellfoxReferenceStore((s) => s.refresh);
  const loadedAt = useSellfoxReferenceStore((s) => s.loadedAt);
  const loadedAtRef = useRef<number | null>(null);
  loadedAtRef.current = loadedAt;

  const scopeKey = useMemo(() => {
    if (typeof window === "undefined") return "";
    const scope = workspaceScopeFromUrl(window.location.href);
    return referenceScopeKey({
      organizationId: user?.organizationId ?? "",
      workspaceId: scope.workspaceId || defaultWorkspaceScope.workspaceId,
      accountId: scope.accountId,
      marketplace: scope.marketplace,
    });
  }, [user?.organizationId]);

  useEffect(() => {
    if (!scopeKey || !user?.organizationId) return;
    void ensureLoaded(scopeKey);
  }, [scopeKey, user?.organizationId, ensureLoaded]);

  // scope 变化（账号/站点/工作区切换）→ 按新 scope 重载，禁止旧数据闪现。
  useEffect(() => {
    const onScope = () => {
      if (typeof window === "undefined") return;
      const scope = workspaceScopeFromUrl(window.location.href);
      const next = referenceScopeKey({
        organizationId: user?.organizationId ?? "",
        workspaceId: scope.workspaceId || defaultWorkspaceScope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
      });
      void ensureLoaded(next);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const last = loadedAtRef.current;
      if (last && Date.now() - last > REVALIDATE_MS) void refresh();
    };
    window.addEventListener(workspaceScopeChangedEventName, onScope);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(workspaceScopeChangedEventName, onScope);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.organizationId, ensureLoaded, refresh]);

  return <>{children}</>;
}
