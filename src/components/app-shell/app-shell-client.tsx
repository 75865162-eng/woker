"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Boxes, History, Home, ListChecks, LogOut, PackageSearch, SearchCheck, Settings, Sparkles, Store, UploadCloud, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getModuleIdForPath, roleCanAccessModule, type RolePermissionMap } from "@/lib/accounts/permissions";
import { cn } from "@/lib/utils";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { WorkspaceScopeSelector } from "./workspace-scope-selector";

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

const navItems = [
  { href: "/", label: "工作台首页", icon: Home, moduleId: null },
  { href: "/dashboard", label: "产品管理", icon: Boxes, moduleId: "products" },
  { href: "/sellfox", label: "Sellfox", icon: Store, moduleId: "products" },
  { href: "/workspace", label: "PPC 优化", icon: UploadCloud, moduleId: "workspace" },
  { href: "/saihu-search-merge", label: "赛狐搜词合并", icon: SearchCheck },
  { href: "/listing-ai", label: "Listing AI", icon: Sparkles, moduleId: "listingAi" },
  { href: "/agents", label: "Amazon AI Agent Platform", icon: Bot, moduleId: "agents" },
  { href: "/logistics", label: "物流处理", icon: PackageSearch, moduleId: "logistics" },
];

const accountMenuItems = [
  { href: "/tasks", label: "任务中心", icon: ListChecks, moduleId: "tasks" },
  { href: "/versions", label: "版本审计", icon: History, moduleId: "versions" },
  { href: "/accounts", label: "账号权限", icon: UsersRound, moduleId: "accounts" },
  { href: "/settings", label: "系统设置", icon: Settings, moduleId: "settings" },
];

export function AppShellClient({
  children,
  title,
  subtitle,
  userInitials = "AM",
  userName,
  userRole,
  rolePermissions,
  appVersionLabel,
}: {
  children: React.ReactNode;
  title: string;
  subtitle: string;
  userInitials?: string;
  userName?: string;
  userRole?: string;
  rolePermissions?: RolePermissionMap | null;
  appVersionLabel: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [contentRevision, setContentRevision] = useState(0);
  const [enableShellEnhancements, setEnableShellEnhancements] = useState(false);
  const accountMenu = accountMenuItems.filter((item) => roleCanAccessModule(userRole, item.moduleId, rolePermissions));
  const visibleNavItems = navItems.filter((item) => {
    if (item.href === "/") return true;

    return roleCanAccessModule(userRole, item.moduleId ?? getModuleIdForPath(item.href), rolePermissions);
  });

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
    <div className="min-h-screen bg-background">
      {enableShellEnhancements ? <WeComNotificationRunner /> : null}
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[76px] flex-col items-center border-r border-border bg-white">
        <div className="flex h-16 w-full items-center justify-center border-b border-border">
          <div className="overflow-hidden rounded-lg">
            <Image src="/brand-logo.png" alt="品牌图标" width={40} height={40} className="h-10 w-10 object-cover" />
          </div>
        </div>
        <nav className="flex flex-1 flex-col items-center gap-2 py-4">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                title={item.label}
                onMouseEnter={() => router.prefetch(item.href)}
                onFocus={() => router.prefetch(item.href)}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-muted hover:text-foreground",
                  active && "bg-brand text-white hover:bg-brand hover:text-white",
                )}
              >
                <Icon className="h-5 w-5" />
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="pl-[76px]">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-white/95 px-6 backdrop-blur">
          <div>
            <h1 className="text-xl font-bold text-foreground">{title}</h1>
            <p className="text-xs font-medium text-muted">{subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
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
                        prefetch={false}
                        className={itemClassName}
                        onMouseEnter={() => router.prefetch(item.href)}
                        onFocus={() => router.prefetch(item.href)}
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
  );
}
