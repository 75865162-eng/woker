"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { LogOut } from "lucide-react";
import { accountMenuItems, matchesNavigationItem, navigationModules } from "./business-navigation";
import { ErpSidebar, SIDEBAR_WIDTH_COLLAPSED, SIDEBAR_WIDTH_EXPANDED, useSidebarState } from "./erp-sidebar";
import { Button } from "@/components/ui/button";
import { getModuleIdForPath, roleCanAccessModule, type RolePermissionMap } from "@/lib/accounts/permissions";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { AppShellUserProvider } from "./app-shell-context";
import { BusinessNavigationDrawer } from "./business-navigation-drawer";
import { WorkspaceScopeSelector } from "./workspace-scope-selector";
import { setWorkspaceApiCacheScope } from "@/lib/workspace/workspace-api-cache";
import { applyDensity, readDensityPreference } from "@/lib/ui/density";

const UserNotificationCenter = dynamic(
  () => import("@/components/notifications/user-notification-center").then((module) => module.UserNotificationCenter),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9 rounded-md border border-border bg-white" />,
  },
);

const WeComNotificationRunner = dynamic(
  () => import("@/components/notifications/wecom-notification-runner").then((module) => module.WeComNotificationRunner),
  { ssr: false, loading: () => null },
);

export function AppShellClient({
  children,
  tabBar,
  contentClassName,
  preserveContent = false,
  title,
  subtitle,
  actions,
  userInitials = "AM",
  userId,
  organizationId,
  userName,
  userRole,
  rolePermissions,
  appVersionLabel,
  authorizationRevision,
  currentHref: currentHrefProp,
}: {
  children: React.ReactNode;
  /** 顶部多标签栏，由 PersistentAppShell 注入。 */
  tabBar?: React.ReactNode;
  /** 内容区 class；多标签模式下用 p-0，让 iframe 铺满。 */
  contentClassName?: string;
  /** 多标签模式下不要因工作区切换重建 iframe，否则页面缓存会失效。 */
  preserveContent?: boolean;
  /** 当前真实地址（含 iframe 内跳转后的地址），用于侧栏高亮。 */
  currentHref?: string;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  userInitials?: string;
  userId?: string;
  organizationId?: string;
  userName?: string;
  userRole?: string;
  rolePermissions?: RolePermissionMap | null;
  appVersionLabel: string;
  authorizationRevision?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [contentRevision, setContentRevision] = useState(0);
  const [enableShellEnhancements, setEnableShellEnhancements] = useState(false);
  const sidebar = useSidebarState();
  const fallbackQuery = searchParams?.toString() ?? "";
  const currentHref = currentHrefProp ?? `${pathname}${fallbackQuery ? `?${fallbackQuery}` : ""}`;
  const location = useMemo(() => {
    const [itemPath, query = ""] = currentHref.split("?");
    return { pathname: itemPath || "/", searchParams: new URLSearchParams(query) };
  }, [currentHref]);
  useLayoutEffect(() => {
    setWorkspaceApiCacheScope(`${organizationId ?? ""}:${userId ?? ""}:${userRole ?? ""}:${authorizationRevision ?? ""}`);
  }, [organizationId, userId, userRole, authorizationRevision]);
  // 顶层外壳与 iframe 内页面共用同一份密度偏好，避免外壳与内容区字号不一致。
  useLayoutEffect(() => {
    applyDensity(readDensityPreference());
  }, []);
  const accountMenu = accountMenuItems.filter((item) => roleCanAccessModule(userRole, item.moduleId, rolePermissions));
  // 权限过滤按「二级菜单」粒度执行，整模权限为空时整个一级模块隐藏。
  const visibleModules = useMemo(
    () => navigationModules
      .map((module) => ({
        ...module,
        items: module.items.filter((item) =>
          roleCanAccessModule(userRole, item.moduleId ?? getModuleIdForPath(item.href.split("?")[0]), rolePermissions)),
      }))
      .filter((module) => module.items.length > 0),
    [userRole, rolePermissions],
  );

  function isNavigationActive(href: string) {
    return matchesNavigationItem(href, location);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  useEffect(() => {
    let cancelled = false;
    const supportsIdleCallback = typeof window.requestIdleCallback === "function";
    const enable = () => {
      if (!cancelled) {
        setEnableShellEnhancements(true);
      }
    };

    const idleCallbackId: number = supportsIdleCallback
      ? window.requestIdleCallback(enable, { timeout: 1500 })
      : window.setTimeout(enable, 900);

    function handleWorkspaceScopeChanged() {
      setContentRevision((current) => current + 1);
    }

    window.addEventListener(workspaceScopeChangedEventName, handleWorkspaceScopeChanged);

    return () => {
      cancelled = true;
      if (supportsIdleCallback) {
        window.cancelIdleCallback(idleCallbackId);
      } else {
        clearTimeout(idleCallbackId);
      }
      window.removeEventListener(workspaceScopeChangedEventName, handleWorkspaceScopeChanged);
    };
  }, []);

  useEffect(() => {
    const shouldBootstrapWorkspaceStore = pathname === "/workspace" || pathname === "/settings";

    if (!shouldBootstrapWorkspaceStore) {
      return;
    }

    let cancelled = false;
    const runBootstrap = () => {
      if (!cancelled) {
        void import("@/lib/stores/workspace-store").then((module) => module.initializeWorkspaceStorePersistence());
      }
    };
    const supportsIdleCallback = typeof window.requestIdleCallback === "function";
    const idleCallbackId: number = supportsIdleCallback
      ? window.requestIdleCallback(runBootstrap, { timeout: 1500 })
      : window.setTimeout(runBootstrap, 900);

    return () => {
      cancelled = true;
      if (supportsIdleCallback) {
        window.cancelIdleCallback(idleCallbackId);
      } else {
        window.clearTimeout(idleCallbackId);
      }
    };
  }, [pathname]);

  return (
    <AppShellUserProvider value={{ organizationId, userId, userInitials, userName, userRole, rolePermissions }}>
      <div
        className="min-h-screen bg-background"
        style={{ "--erp-sidebar-width": `${sidebar.collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED}px` } as React.CSSProperties}
      >
      {enableShellEnhancements ? <WeComNotificationRunner /> : null}
      <ErpSidebar modules={visibleModules} currentHref={currentHref} state={sidebar} />
      <main className="transition-[padding] duration-150 lg:pl-[var(--erp-sidebar-width)]">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-border bg-white/95 px-5 backdrop-blur">
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-bold leading-tight text-foreground">{title}</h1>
            {subtitle ? <p className="truncate text-[11px] leading-tight text-muted">{subtitle}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <BusinessNavigationDrawer groups={visibleModules} isActive={isNavigationActive} />
            {actions}
            <WorkspaceScopeSelector />
            {enableShellEnhancements ? <UserNotificationCenter /> : <div className="h-8 w-8 rounded-md border border-border bg-white" aria-hidden="true" />}
            <div className="hidden items-center gap-2 xl:flex">
              <span className="max-w-[150px] truncate text-[11px] font-medium text-muted">{appVersionLabel}</span>
            </div>
            <div className="group relative">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-dark text-[11px] font-bold text-white outline-none ring-brand transition group-hover:ring-2 focus-visible:ring-2"
                title={[userName, userRole].filter(Boolean).join(" / ")}
              >
                {userInitials}
              </button>
              <div className="invisible absolute right-0 top-full z-30 w-56 translate-y-1 rounded-lg border border-border bg-white p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-[13px] font-bold text-foreground">{userName || userInitials}</p>
                  {userRole ? <p className="mt-0.5 truncate text-[11px] font-medium text-muted">{userRole}</p> : null}
                </div>
                <div className="py-1">
                  {accountMenu.map((item) => {
                    const Icon = item.icon;
                    const itemClassName = "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-muted";

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={itemClassName}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
                <div className="border-t border-border pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-start px-3 text-[13px] font-medium"
                    onClick={handleLogout}
                  >
                    <LogOut className="h-4 w-4" />
                    退出登录
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </header>
        {tabBar}
        <div key={preserveContent ? undefined : contentRevision} className={contentClassName ?? "p-5"}>
          {children}
        </div>
      </main>
      </div>
    </AppShellUserProvider>
  );
}
