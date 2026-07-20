"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Boxes, Home, ImageUp, PackageSearch, SearchCheck, Settings, SlidersHorizontal, Sparkles, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/dashboard", label: "Products", icon: Boxes },
  { href: "/workspace", label: "Workspace", icon: UploadCloud },
  { href: "/saihu-search-merge", label: "赛狐搜词合并", icon: SearchCheck },
  { href: "/listing-ai", label: "Listing AI", icon: Sparkles },
  { href: "/image-upscale", label: "Image Upscale", icon: ImageUp },
  { href: "/logistics", label: "Logistics", icon: PackageSearch },
  { href: "/rules", label: "Rules", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[76px] flex-col items-center border-r border-border bg-white">
        <div className="flex h-16 w-full items-center justify-center border-b border-border">
          <div className="overflow-hidden rounded-lg">
            <Image src="/brand-logo.png" alt="品牌图标" width={40} height={40} className="h-10 w-10 object-cover" />
          </div>
        </div>
        <nav className="flex flex-1 flex-col items-center gap-2 py-4">
          {navItems.map((item) => {
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
            <div className="hidden items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-muted md:flex">
              <BarChart3 className="h-4 w-4 text-brand" />
              Data date 2026-06-17
            </div>
            <div className="hidden items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-muted md:flex">
              <Bot className="h-4 w-4 text-accent" />
              AI Engine Ready
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-dark text-xs font-bold text-white">AM</div>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
