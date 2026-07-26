"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Home, ImageUp, LogOut, PackageSearch, SearchCheck, Settings, SlidersHorizontal, Sparkles, UploadCloud, UsersRound } from "lucide-react";
import { WeComNotificationRunner } from "@/components/notifications/wecom-notification-runner";
import { Button } from "@/components/ui/button";
import { getModuleIdForPath, roleCanAccessModule, roleHasAnyPage, type RolePermissionMap } from "@/lib/accounts/permissions";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home", icon: Home, moduleId: null },
  { href: "/dashboard", label: "Products", icon: Boxes, moduleId: "products" },
  { href: "/workspace", label: "Workspace", icon: UploadCloud, moduleId: "workspace" },
  { href: "/saihu-search-merge", label: "赛狐搜词合并", icon: SearchCheck },
  { href: "/listing-ai", label: "Listing AI", icon: Sparkles, moduleId: "listingAi" },
  { href: "/image-upscale", label: "Image Upscale", icon: ImageUp, moduleId: "imageUpscale" },
  { href: "/logistics", label: "Logistics", icon: PackageSearch, moduleId: "logistics" },
  { href: "/rules", label: "Rules", icon: SlidersHorizontal, moduleId: "rules" },
  { href: "/accounts", label: "Accounts", icon: UsersRound, moduleId: "accounts" },
  { href: "/settings", label: "Settings", icon: Settings, moduleId: "settings" },
];

export function AppShellClient({
  children,
  title,
  subtitle,
  userInitials = "AM",
  userRole,
  rolePermissions,
}: {
  children: React.ReactNode;
  title: string;
  subtitle: string;
  userInitials?: string;
  userRole?: string;
  rolePermissions?: RolePermissionMap | null;
}) {
  const pathname = usePathname();
  const canAccessAnyPage = roleHasAnyPage(userRole, rolePermissions);
  const visibleNavItems = navItems.filter((item) => {
    if (item.href === "/") return canAccessAnyPage;

    return roleCanAccessModule(userRole, item.moduleId ?? getModuleIdForPath(item.href), rolePermissions);
  });

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-background">
      <WeComNotificationRunner />
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
                title={item.label}
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
            <Button type="button" variant="ghost" size="icon" title="退出登录" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-dark text-xs font-bold text-white">{userInitials}</div>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
