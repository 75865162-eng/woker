"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, Pin, PinOff, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";
import { cn } from "@/lib/utils";
import { usePinnedNav } from "./pinned-nav";

// Wimoor layout/components/Aside/AsideMenu.vue: grouped business submenu drawer.
// Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt.
type DrawerItem = { id?: string; href: string; label: string; icon: LucideIcon };
export function BusinessNavigationDrawer({ groups, isActive }: {
  groups: Array<{ label: string; items: DrawerItem[] }>;
  isActive: (href: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { isPinned, togglePin } = usePinnedNav();
  const matches = groups.map(group => ({ ...group, items: group.items.filter(item => `${group.label} ${item.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter(group => group.items.length);
  return <>
    <Button variant="secondary" size="sm" aria-label="打开业务菜单" onClick={() => { setQuery(""); setOpen(true); }}><Menu className="h-4 w-4" /><span className="hidden sm:inline">业务菜单</span></Button>
    <WorkbenchDialog open={open} title="业务菜单" drawer onClose={() => setOpen(false)}>
      <label className="mb-5 flex items-center gap-2 rounded border border-border px-3"><Search aria-hidden className="h-4 w-4 text-muted" /><input aria-label="搜索业务入口" placeholder="搜索页面或业务模块" value={query} onChange={event => setQuery(event.target.value)} className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      <nav aria-label="业务模块入口" className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {matches.map(group => <section key={group.label}>
          <h3 className="mb-2 border-b border-border pb-2 text-xs font-semibold text-muted">{group.label}</h3>
          <div className="space-y-1">{group.items.map(item => {
            const active = isActive(item.href);
            const pinned = item.id ? isPinned(item.id) : false;
            return (
              <div key={item.href} className={`flex min-h-10 items-center gap-2 rounded px-3 py-2 text-sm ${active ? "bg-brand/10 font-semibold text-brand" : "hover:bg-surface-muted text-foreground"}`}>
                <Link href={item.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)} className="flex min-w-0 flex-1 items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  <item.icon aria-hidden className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
                {item.id ? (
                  <button
                    type="button"
                    aria-label={pinned ? `取消固定 ${item.label}` : `固定到侧栏 ${item.label}`}
                    title={pinned ? "取消固定" : "固定到侧栏"}
                    onClick={(event) => { event.preventDefault(); event.stopPropagation(); togglePin(item.id!); }}
                    className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand", pinned ? "text-brand hover:bg-brand/10" : "text-muted opacity-50 hover:bg-surface-muted hover:text-brand hover:opacity-100")}
                  >
                    {pinned ? <PinOff aria-hidden className="h-4 w-4" /> : <Pin aria-hidden className="h-4 w-4" />}
                  </button>
                ) : null}
              </div>
            );
          })}</div>
        </section>)}
      </nav>
      {!matches.length && <p role="status" className="py-10 text-center text-sm text-muted">没有匹配的业务入口。</p>}
    </WorkbenchDialog>
  </>;
}
