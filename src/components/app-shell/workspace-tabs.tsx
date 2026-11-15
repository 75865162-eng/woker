"use client";

import { useEffect, useRef, useState } from "react";
import { accountMenuItems, navigationGroups } from "./business-navigation";

export type WorkspaceTab = {
  id: string;
  /** 当前逻辑地址，用于顶栏 URL 与侧边栏高亮。 */
  href: string;
  /** iframe 的固定加载地址；创建后不再改变，避免 React 重新赋值 src 导致页面刷新。 */
  src: string;
  label: string;
  /** 导航配置里带中文名的标签，不允许被页面标题覆盖。 */
  locked?: boolean;
};

export const HOME_HREF = "/dashboard";
/** 标签上限。ERP 实际使用常在 10–20 个标签，标签本身只是元数据，不占页面状态。 */
export const MAX_TABS = 20;
/** 同时保留「组件状态 + DOM」的页面数上限；超出后按最近使用时间淘汰最久没打开的那个。 */
export const MAX_VIEWS = 6;

const navLabels = new Map<string, string>();
for (const group of navigationGroups) {
  for (const item of group.items) navLabels.set(item.href, item.label);
}
for (const item of accountMenuItems) navLabels.set(item.href, item.label);
navLabels.set("/", "工作台");

export function splitHref(href: string): { pathname: string; search: string } {
  const index = href.indexOf("?");
  const pathname = index < 0 ? href : href.slice(0, index);
  const search = index < 0 ? "" : href.slice(index + 1);
  return { pathname: pathname || "/", search };
}

/** 把任意站内链接统一成 pathname + search 的形式，作为标签页身份。 */
export function normalizeHref(href: string): string {
  const { pathname, search } = splitHref(href);
  return `${pathname}${search ? `?${search}` : ""}`;
}

function fallbackLabel(href: string): string {
  const { pathname, search } = splitHref(href);
  const segment = pathname.split("/").filter(Boolean).pop() ?? "工作台";
  const view = new URLSearchParams(search).get("view") ?? new URLSearchParams(search).get("tab");
  const raw = view ? `${segment} · ${view}` : segment;
  return raw.length > 16 ? `${raw.slice(0, 15)}…` : raw;
}

export function labelForHref(href: string, linkText?: string): { label: string; locked: boolean } {
  const known = navLabels.get(href) ?? navLabels.get(splitHref(href).pathname);
  if (known) return { label: known, locked: true };
  // 帮助中心的文章详情归到「帮助中心」这一个入口下，标签不跟着文章名变化。
  if (splitHref(href).pathname.startsWith("/help/")) return { label: "帮助中心", locked: true };
  const text = (linkText ?? "").trim().replace(/\s+/g, " ").replace(/[→»>]+$/g, "").trim();
  if (text && text.length <= 16) return { label: text, locked: false };
  return { label: fallbackLabel(href), locked: false };
}

type TabBarProps = {
  tabs: WorkspaceTab[];
  activeId: string;
  cachedIds: string[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRefresh: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
};

export function WorkspaceTabBar({ tabs, activeId, cachedIds, onSelect, onClose, onRefresh, onCloseOthers, onCloseAll }: TabBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  return (
    <div className="sticky top-[var(--shell-topbar)] z-[9] flex h-[var(--shell-tabbar)] items-center gap-2 border-b border-border bg-surface/95 px-6 backdrop-blur">
      <div className="thin-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const cached = cachedIds.includes(tab.id);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              title={`${tab.label}${cached ? " · 已缓存，切换不重新加载" : ""}`}
              className={`group flex h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors ${
                active
                  ? "border-brand/30 bg-brand/10 text-brand"
                  : "border-border bg-surface text-foreground/70 hover:border-brand/30 hover:text-brand"
              }`}
            >
              <button
                type="button"
                className="max-w-[150px] truncate outline-none focus-visible:underline"
                onClick={() => onSelect(tab.id)}
              >
                {tab.label}
              </button>
              {cached ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-success/70" title="页面已缓存" /> : null}
              <button
                type="button"
                aria-label={`关闭 ${tab.label}`}
                title="关闭标签页"
                className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-body leading-none text-muted outline-none hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-brand"
                onClick={() => onClose(tab.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          aria-label="标签页操作"
          title="标签页操作"
          className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold text-muted outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden>⋯</span>
          <span className="hidden sm:inline">{tabs.length} 个页签</span>
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg border border-border bg-surface p-1.5 text-xs shadow-lg">
            {[
              { label: "刷新当前页", action: onRefresh },
              { label: "关闭其他页签", action: onCloseOthers },
              { label: "关闭全部页签", action: onCloseAll },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                className="w-full rounded px-2.5 py-2 text-left font-medium text-foreground hover:bg-surface-muted"
                onClick={() => { setMenuOpen(false); item.action(); }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
