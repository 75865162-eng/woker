"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";

// Wimoor layout/components/Aside/AsideMenu.vue: grouped business submenu drawer.
// Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt.
export function BusinessNavigationDrawer({ groups, isActive }: {
  groups: Array<{ label: string; items: Array<{ href: string; label: string; icon: LucideIcon }> }>;
  isActive: (href: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = groups.map(group => ({ ...group, items: group.items.filter(item => `${group.label} ${item.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter(group => group.items.length);
  return <>
    <Button variant="secondary" size="sm" aria-label="打开业务菜单" onClick={() => { setQuery(""); setOpen(true); }}><Menu className="h-4 w-4" /><span className="hidden sm:inline">业务菜单</span></Button>
    <WorkbenchDialog open={open} title="业务菜单" drawer onClose={() => setOpen(false)}>
      <label className="mb-5 flex items-center gap-2 rounded border border-border px-3"><Search aria-hidden className="h-4 w-4 text-muted" /><input aria-label="搜索业务入口" placeholder="搜索页面或业务模块" value={query} onChange={event => setQuery(event.target.value)} className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      <nav aria-label="业务模块入口" className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {matches.map(group => <section key={group.label}>
          <h3 className="mb-2 border-b border-border pb-2 text-xs font-semibold text-muted">{group.label}</h3>
          <div className="space-y-1">{group.items.map(item => <Link key={item.href} href={item.href} prefetch={false} aria-current={isActive(item.href) ? "page" : undefined} onClick={() => setOpen(false)} className={`flex min-h-10 items-center gap-2 rounded px-3 py-2 text-sm hover:bg-surface-muted ${isActive(item.href) ? "bg-brand/10 font-semibold text-brand" : "text-foreground"}`}><item.icon aria-hidden className="h-4 w-4 shrink-0" />{item.label}</Link>)}</div>
        </section>)}
      </nav>
      {!matches.length && <p role="status" className="py-10 text-center text-sm text-muted">没有匹配的业务入口。</p>}
    </WorkbenchDialog>
  </>;
}
