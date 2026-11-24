"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CircleHelp, LogOut, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { accountMenuItems, navigationGroups } from "./business-navigation";
import { syncCenterDrawerLinks } from "@/components/operations/operations-sections";
import { PinnedNavProvider } from "./pinned-nav";
import { NavigationSidebar } from "./navigation-sidebar";
import { Button } from "@/components/ui/button";
import { getModuleIdForPath, roleCanAccessModule, type RolePermissionMap } from "@/lib/accounts/permissions";
import { useShellStore } from "@/lib/stores/shell-store";
import { cn } from "@/lib/utils";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { startWebVitals } from "@/lib/observability/web-vitals";
import { AppShellUserProvider } from "./app-shell-context";
import { BusinessNavigationDrawer } from "./business-navigation-drawer";
import { WorkspaceScopeSelector } from "./workspace-scope-selector";
import { setWorkspaceApiCacheScope } from "@/lib/workspace/workspace-api-cache";

const UserNotificationCenter = dynamic(
  () => import("@/components/notifications/user-notification-center").then((module) => module.UserNotificationCenter),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9 rounded-md border border-border bg-surface" />,
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
}: {
  children: React.ReactNode;
  /** 顶部多标签栏，由 PersistentAppShell 注入。 */
  tabBar?: React.ReactNode;
  /** 内容区 class；多标签模式下用 p-0，让 iframe 铺满。 */
  contentClassName?: string;
  /** 多标签模式下不要因工作区切换重建 iframe，否则页面缓存会失效。 */
  preserveContent?: boolean;
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
  useLayoutEffect(() => {
    setWorkspaceApiCacheScope(`${organizationId ?? ""}:${userId ?? ""}:${userRole ?? ""}:${authorizationRevision ?? ""}`);
  }, [organizationId, userId, userRole, authorizationRevision]);
  const accountMenu = accountMenuItems.filter((item) => roleCanAccessModule(userRole, item.moduleId, rolePermissions));
  const visibleNavigationGroups = navigationGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => roleCanAccessModule(userRole, item.moduleId ?? getModuleIdForPath(item.href.split("?")[0]), rolePermissions)),
  })).filter((group) => group.items.length > 0);
  // 原同步中心顶部 A-G 导航已移除，入口改在「业务菜单」抽屉按原分组展示。
  const syncLinksBySection = syncCenterDrawerLinks().reduce<Record<string, typeof visibleNavigationGroups[number]["items"]>>((acc, link) => {
    (acc[link.sectionLabel] ??= []).push({ id: link.id, href: link.href, label: link.label, icon: RefreshCw, moduleId: null });
    return acc;
  }, {});
  const syncDrawerGroups = Object.entries(syncLinksBySection).map(([sectionLabel, items]) => ({ label: sectionLabel, items }));
  const drawerGroups = [...visibleNavigationGroups, ...syncDrawerGroups];

  function isNavigationActive(href: string) {
    const [itemPath, itemQuery] = href.split("?");
    // 帮助中心的文章详情是 /help/<id>，导航仍停在「帮助中心」这一项上。
    if (itemPath === "/help") return pathname === "/help" || pathname.startsWith("/help/");
    return pathname === itemPath && (itemQuery ? [...new URLSearchParams(itemQuery)].every(([key, value]) => searchParams.get(key) === value || (key === "tab" && value === "warehouses" && !searchParams.has(key))) : !href.startsWith("/operations") || !searchParams.has("view"));
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/HKQ";
  }

  const navCollapsed = useShellStore((state) => state.navCollapsed);
  const toggleNav = useShellStore((state) => state.toggleNav);
  const hydrateNav = useShellStore((state) => state.hydrateNav);

  useEffect(() => {
    hydrateNav();
  }, [hydrateNav]);

  // M0 RUM：采集 FCP/LCP/INP/CLS/TTFB，路由变化时重新观测该页。
  useEffect(() => {
    const stop = startWebVitals({ page: pathname || "/" });
    return () => stop();
  }, [pathname]);

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
      <PinnedNavProvider userRole={userRole} rolePermissions={rolePermissions ?? null}>
      <div className="min-h-screen bg-background">
      {enableShellEnhancements ? <WeComNotificationRunner /> : null}
      <aside
        data-collapsed={navCollapsed ? "true" : "false"}
        className={cn(
          "fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out lg:flex",
          navCollapsed ? "w-[var(--shell-nav-collapsed)]" : "w-[var(--shell-nav)]",
        )}
      >
        <div className={cn("flex h-[var(--shell-topbar)] w-full shrink-0 items-center border-b border-border", navCollapsed ? "justify-center px-0" : "px-4")}>
          <Link href="/erp" prefetch={false} aria-label="工作台首页" title="工作台首页" className="flex min-w-0 items-center gap-2 overflow-hidden rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <Image src="/brand-logo.png" alt="品牌图标" width={32} height={32} className="h-7 w-7 shrink-0 object-cover" />
            <span className={cn("truncate text-section text-foreground", navCollapsed && "sr-only")}>条条 ERP</span>
          </Link>
        </div>
        <NavigationSidebar groups={visibleNavigationGroups} navCollapsed={navCollapsed} isActive={isNavigationActive} />
        <div className={cn("flex shrink-0 items-center gap-2 border-t border-border bg-surface p-2", navCollapsed && "justify-center")}>
          <button
            type="button"
            onClick={toggleNav}
            aria-label={navCollapsed ? "展开侧边导航" : "收起侧边导航"}
            aria-expanded={!navCollapsed}
            title={navCollapsed ? "展开侧边导航" : "收起侧边导航"}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md text-meta text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              navCollapsed ? "w-8 justify-center" : "min-w-0 px-2",
            )}
          >
            {navCollapsed ? <PanelLeftOpen aria-hidden className="h-4 w-4" /> : <PanelLeftClose aria-hidden className="h-4 w-4" />}
            {navCollapsed ? null : <span>收起导航</span>}
          </button>
          {navCollapsed ? null : <span title={appVersionLabel} className="min-w-0 truncate text-label text-muted">{appVersionLabel}</span>}
        </div>
      </aside>
      <main className={cn("transition-[padding] duration-200 ease-out", navCollapsed ? "lg:pl-[var(--shell-nav-collapsed)]" : "lg:pl-[var(--shell-nav)]")}>
        <header className="sticky top-0 z-10 flex h-[var(--shell-topbar)] items-center justify-between gap-4 border-b border-border bg-surface/95 px-6 backdrop-blur">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="shrink-0 text-display text-foreground">{title}</h1>
            {subtitle ? <span aria-hidden className="text-meta text-border-strong">/</span> : null}
            {subtitle ? <p className="truncate text-meta text-muted">{subtitle}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <BusinessNavigationDrawer groups={drawerGroups} isActive={isNavigationActive} />
            {actions}
            <WorkspaceScopeSelector />
            <Link
              href="/help"
              prefetch={false}
              aria-label="帮助中心"
              title="帮助中心"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-muted transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <CircleHelp className="h-4 w-4" />
            </Link>
            {enableShellEnhancements ? <UserNotificationCenter /> : <div className="h-9 w-9 rounded-md border border-border bg-surface" aria-hidden="true" />}
            <div className="group relative">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-dark text-xs font-semibold text-white outline-none ring-brand transition group-hover:ring-2 focus-visible:ring-2"
                title={[userName, userRole].filter(Boolean).join(" / ")}
              >
                {userInitials}
              </button>
              <div className="invisible absolute right-0 top-full z-30 w-56 translate-y-1 rounded-lg border border-border bg-surface p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-sm font-semibold text-foreground">{userName || userInitials}</p>
                  {userRole ? <p className="mt-0.5 truncate text-xs font-medium text-muted">{userRole}</p> : null}
                </div>
                <div className="py-1">
                  {accountMenu.map((item) => {
                    const Icon = item.icon;
                    const itemClassName = "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted";

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        prefetch={false}
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
                    className="w-full justify-start px-3 text-sm font-semibold"
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
        <div key={preserveContent ? undefined : contentRevision} className={contentClassName ?? "p-6"}>
          {children}
        </div>
      </main>
      </div>
      </PinnedNavProvider>
    </AppShellUserProvider>
  );
}
