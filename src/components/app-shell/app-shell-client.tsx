"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { LogOut } from "lucide-react";
import { accountMenuItems, navigationGroups } from "./business-navigation";
import { Button } from "@/components/ui/button";
import { getModuleIdForPath, roleCanAccessModule, type RolePermissionMap } from "@/lib/accounts/permissions";
import { cn } from "@/lib/utils";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { AppShellUserProvider } from "./app-shell-context";
import { BusinessNavigationDrawer } from "./business-navigation-drawer";
import { WorkspaceScopeSelector } from "./workspace-scope-selector";
import { setWorkspaceApiCacheScope } from "@/lib/workspace/workspace-api-cache";

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

  function isNavigationActive(href: string) {
    const [itemPath, itemQuery] = href.split("?");
    return pathname === itemPath && (itemQuery ? [...new URLSearchParams(itemQuery)].every(([key, value]) => searchParams.get(key) === value || (key === "tab" && value === "warehouses" && !searchParams.has(key))) : !href.startsWith("/operations") || !searchParams.has("view"));
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
      <div className="min-h-screen bg-background">
      {enableShellEnhancements ? <WeComNotificationRunner /> : null}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[184px] flex-col border-r border-border bg-white lg:flex">
        <div className="flex h-16 w-full items-center border-b border-border px-4">
          <Link href="/" aria-label="工作台首页" title="工作台首页" className="overflow-hidden rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <Image src="/brand-logo.png" alt="品牌图标" width={32} height={32} className="h-8 w-8 object-cover" />
          </Link>
        </div>
        <nav aria-label="业务导航" className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-1">
          {visibleNavigationGroups.map((group) => <section key={group.label} className="mb-1">
            <h2 className="cursor-default select-none px-2 pb-1 pt-3 text-[11px] font-semibold tracking-wide text-muted">{group.label}</h2>
            <div className="space-y-0.5">
          {group.items.map((item) => {
            const active = isNavigationActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={cn(
                  "flex min-h-9 items-center rounded-md px-2.5 py-1.5 text-[13px] leading-5 text-foreground/80 transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                  active && "bg-brand font-semibold text-white hover:bg-brand hover:text-white",
                )}
              >
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
            </div>
          </section>)}
        </nav>
      </aside>
      <main className="lg:pl-[184px]">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-white/95 px-6 backdrop-blur">
          <div>
            <h1 className="text-xl font-bold text-foreground">{title}</h1>
            <p className="text-xs font-medium text-muted">{subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <BusinessNavigationDrawer groups={visibleNavigationGroups} isActive={isNavigationActive} />
            {actions}
            <WorkspaceScopeSelector />
            {enableShellEnhancements ? <UserNotificationCenter /> : <div className="h-9 w-9 rounded-md border border-border bg-white" aria-hidden="true" />}
            <div className="hidden items-center gap-2 lg:flex">
              <span className="max-w-[180px] truncate text-xs font-semibold text-muted">{appVersionLabel}</span>
            </div>
            <div className="group relative">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-dark text-xs font-bold text-white outline-none ring-brand transition group-hover:ring-2 focus-visible:ring-2"
                title={[userName, userRole].filter(Boolean).join(" / ")}
              >
                {userInitials}
              </button>
              <div className="invisible absolute right-0 top-full z-30 w-56 translate-y-1 rounded-lg border border-border bg-white p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-sm font-bold text-foreground">{userName || userInitials}</p>
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
        <div key={contentRevision} className="p-6">
          {children}
        </div>
      </main>
      </div>
    </AppShellUserProvider>
  );
}
