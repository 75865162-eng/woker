"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import {
  findNavigationModule,
  matchesNavigationItem,
  type NavigationItem,
  type NavigationModule,
} from "./business-navigation";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "woker:erp-nav-state:v1";
export const SIDEBAR_WIDTH_EXPANDED = 220;
export const SIDEBAR_WIDTH_COLLAPSED = 64;

type StoredNavState = { collapsed?: boolean; open?: string[] };

export type SidebarState = {
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  openModules: string[];
  toggleModule: (id: string) => void;
  ensureOpen: (id: string) => void;
};

/**
 * 侧栏状态（收起 / 展开的模块）统一由外壳持有：
 * 侧栏本身与主内容区左内边距需要同一份状态，避免两份 truth 不同步。
 * 状态写入 localStorage，刷新浏览器后保持用户上次的展开形态。
 */
export function useSidebarState(): SidebarState {
  const [collapsed, setCollapsedState] = useState(false);
  const [openModules, setOpenModules] = useState<string[]>([]);
  const restoredRef = useRef(false);

  useLayoutEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredNavState;
      if (typeof parsed.collapsed === "boolean") setCollapsedState(parsed.collapsed);
      if (Array.isArray(parsed.open)) {
        setOpenModules(parsed.open.filter((id): id is string => typeof id === "string"));
      }
    } catch {
      // 本地数据损坏时保持默认展开状态。
    }
  }, []);

  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ collapsed, open: openModules } satisfies StoredNavState));
    } catch {
      // 隐私模式下忽略。
    }
  }, [collapsed, openModules]);

  const setCollapsed = useCallback((next: boolean) => setCollapsedState(next), []);
  const toggleModule = useCallback((id: string) => {
    setOpenModules((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);
  const ensureOpen = useCallback((id: string) => {
    setOpenModules((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  return { collapsed, setCollapsed, openModules, toggleModule, ensureOpen };
}

function itemKey(item: NavigationItem) {
  return item.href;
}

function ModuleFlyout({ module, isActive, onNavigate, top, onClose }: {
  module: NavigationModule;
  isActive: (href: string) => boolean;
  onNavigate: () => void;
  top: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolvedTop, setResolvedTop] = useState(top);
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    setResolvedTop(Math.min(Math.max(8, top), maxTop));
  }, [top]);
  useLayoutEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${module.label} 功能菜单`}
      className="fixed z-40 w-[212px] rounded-lg border border-border bg-white py-1.5 shadow-lg"
      style={{ top: resolvedTop, left: SIDEBAR_WIDTH_COLLAPSED + 6 }}
    >
      <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-1 text-[11px] font-semibold tracking-wide text-muted">
        <module.icon aria-hidden className="h-3.5 w-3.5" />
        {module.label}
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        {module.items.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={itemKey(item)}
              href={item.href}
              role="menuitem"
              title={item.hint ?? item.label}
              onClick={onNavigate}
              className={cn(
                "mx-1.5 flex h-[34px] items-center gap-2 rounded-md px-2.5 text-[13px] leading-5 text-foreground/85 transition-colors hover:bg-surface-muted hover:text-foreground",
                active && "bg-brand/10 font-medium text-brand hover:bg-brand/10 hover:text-brand",
              )}
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function ErpSidebar({ modules, currentHref, state }: {
  modules: NavigationModule[];
  /** 当前真实页面地址（含 iframe 内跳转后的地址）。 */
  currentHref: string;
  state: SidebarState;
}) {
  const { collapsed, setCollapsed, openModules, toggleModule, ensureOpen } = state;
  const [query, setQuery] = useState("");
  const [flyout, setFlyout] = useState<{ id: string; top: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const location = useMemo(() => {
    const [pathname, search = ""] = currentHref.split("?");
    return { pathname: pathname || "/", searchParams: new URLSearchParams(search) };
  }, [currentHref]);

  const isActive = useCallback(
    (href: string) => matchesNavigationItem(href, location),
    [location],
  );

  const activeModuleId = useMemo(() => findNavigationModule(currentHref)?.id ?? null, [currentHref]);

  // 路由变化（含 iframe 内跳转）后自动展开所属一级模块。
  useEffect(() => {
    if (activeModuleId) ensureOpen(activeModuleId);
  }, [activeModuleId, ensureOpen]);

  useEffect(() => {
    setFlyout(null);
  }, [currentHref]);

  // 全局快捷键：Ctrl/⌘ + K 聚焦菜单搜索（与帮助中心文档一致）。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLocaleLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setCollapsed(false);
      window.setTimeout(() => searchRef.current?.focus(), 120);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setCollapsed]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return modules.flatMap((module) =>
      module.items
        .filter((item) => `${module.label} ${item.label} ${item.hint ?? ""}`.toLocaleLowerCase().includes(normalizedQuery))
        .map((item) => ({ module, item })),
    );
  }, [modules, normalizedQuery]);

  const toggleLabel = collapsed ? "展开侧栏" : "收起侧栏";

  return (
    <aside
      className="fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-border bg-white transition-[width] duration-150 lg:flex"
      style={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="侧边导航"
    >
      <div className={cn("flex h-14 shrink-0 items-center gap-2 border-b border-border", collapsed ? "justify-center px-2" : "px-3.5")}>
        <Link
          href="/"
          aria-label="工作台首页"
          title="工作台首页"
          className="flex min-w-0 items-center gap-2 rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Image src="/brand-logo.png" alt="品牌图标" width={28} height={28} className="h-7 w-7 shrink-0 rounded object-cover" />
          {collapsed ? null : (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[13px] font-bold text-foreground">条条 ERP</span>
              <span className="truncate text-[10px] text-muted">Amazon 业务系统</span>
            </span>
          )}
        </Link>
      </div>

      {collapsed ? (
        <div className="flex h-9 shrink-0 items-center justify-center border-b border-border">
          <button
            type="button"
            aria-label="打开菜单搜索"
            title="搜索菜单（Ctrl+K）"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand"
            onClick={() => { setCollapsed(false); window.setTimeout(() => searchRef.current?.focus(), 120); }}
          >
            <Search aria-hidden className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="shrink-0 px-2 pb-1.5 pt-2">
          <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-muted/60 px-2 focus-within:border-brand/50 focus-within:bg-white">
            <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
                if (event.key === "Enter" && searchResults[0]) {
                  resultsRef.current?.querySelector<HTMLAnchorElement>("a")?.click();
                }
              }}
              aria-label="搜索菜单"
              placeholder="搜索功能 / 页面"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
            />
            {query ? (
              <button
                type="button"
                aria-label="清除搜索"
                className="flex h-4 w-4 items-center justify-center rounded-full text-muted hover:text-foreground"
                onClick={() => { setQuery(""); searchRef.current?.focus(); }}
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
        </div>
      )}

      <nav aria-label="业务导航" className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-3 pt-1">
        {normalizedQuery ? (
          <div className="pt-1" ref={resultsRef}>
            <p className="px-2 pb-1.5 text-[11px] font-semibold text-muted">
              匹配 {searchResults.length} 项
            </p>
            {searchResults.map(({ module, item }) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={`${module.id}-${itemKey(item)}`}
                  href={item.href}
                  onClick={() => setQuery("")}
                  title={item.hint ?? item.label}
                  className={cn(
                    "flex h-[34px] items-center gap-2 rounded-md px-2 text-[13px] leading-5 text-foreground/85 transition-colors hover:bg-surface-muted hover:text-foreground",
                    active && "bg-brand/10 font-medium text-brand",
                  )}
                >
                  <item.icon aria-hidden className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="max-w-[64px] shrink-0 truncate text-[10px] text-muted">{module.label}</span>
                </Link>
              );
            })}
            {!searchResults.length ? (
              <p className="px-2 py-6 text-center text-[13px] text-muted">没有匹配的功能入口。</p>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {modules.map((module, index) => {
              const Icon = module.icon;
              const single = module.items.length === 1;
              const open = openModules.includes(module.id) || single;
              const moduleActive = activeModuleId === module.id;
              const listId = `nav-module-${module.id}`;

              if (single) {
                const item = module.items[0];
                const active = isActive(item.href);
                return (
                  <li key={module.id} className={index > 0 ? "pt-1" : undefined}>
                    <Link
                      href={item.href}
                      title={collapsed ? module.label : module.hint}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex h-10 items-center gap-2.5 rounded-md text-[13px] font-medium text-foreground/85 transition-colors hover:bg-surface-muted hover:text-foreground",
                        collapsed ? "justify-center px-0" : "px-2.5",
                        active && "bg-brand/10 text-brand hover:bg-brand/10 hover:text-brand",
                      )}
                    >
                      {active ? <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-brand" /> : null}
                      <Icon aria-hidden className="h-4 w-4 shrink-0" />
                      {collapsed ? null : <span className="truncate">{module.label}</span>}
                    </Link>
                  </li>
                );
              }

              return (
                <li key={module.id} className={index > 0 ? "pt-1" : undefined}>
                  <button
                    type="button"
                    aria-expanded={collapsed ? flyout?.id === module.id : open}
                    aria-controls={listId}
                    title={collapsed ? module.label : module.hint}
                    onClick={(event) => {
                      if (collapsed) {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setFlyout((current) => (current?.id === module.id ? null : { id: module.id, top: rect.top }));
                        return;
                      }
                      toggleModule(module.id);
                    }}
                    className={cn(
                      "group relative flex h-10 w-full items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                      collapsed ? "justify-center px-0" : "px-2.5",
                      moduleActive ? "text-brand" : "text-foreground/85",
                      "hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    {moduleActive ? (
                      <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-brand" />
                    ) : null}
                    <Icon aria-hidden className="h-4 w-4 shrink-0" />
                    {collapsed ? null : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-left">{module.label}</span>
                        <ChevronDown
                          aria-hidden
                          className={cn("h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-150", open && "rotate-180")}
                        />
                      </>
                    )}
                  </button>
                  {!collapsed && open ? (
                    <ul id={listId} className="mt-0.5 space-y-px pb-1">
                      {module.items.map((item) => {
                        const active = isActive(item.href);
                        return (
                          <li key={itemKey(item)}>
                            <Link
                              href={item.href}
                              title={item.hint ?? item.label}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "relative flex h-[34px] items-center rounded-md pl-8 pr-2.5 text-[13px] leading-5 text-foreground/80 transition-colors hover:bg-surface-muted hover:text-foreground",
                                active && "bg-brand/10 font-medium text-brand hover:bg-brand/10 hover:text-brand",
                              )}
                            >
                              {active ? <span aria-hidden className="absolute left-[13px] top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-r bg-brand" /> : null}
                              <span className="truncate">{item.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className={cn("shrink-0 border-t border-border", collapsed ? "p-1" : "p-1.5")}>
        <button
          type="button"
          onClick={() => { setCollapsed(!collapsed); setFlyout(null); }}
          aria-label={toggleLabel}
          title={toggleLabel}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-md text-[12px] font-medium text-muted outline-none transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand",
            collapsed ? "justify-center px-0" : "px-2",
          )}
        >
          {collapsed ? <PanelLeftOpen aria-hidden className="h-4 w-4" /> : <PanelLeftClose aria-hidden className="h-4 w-4" />}
          {collapsed ? null : <span>收起侧栏</span>}
        </button>
      </div>

      {collapsed && flyout ? (() => {
        const flyoutModule = modules.find((item) => item.id === flyout.id);
        if (!flyoutModule) return null;
        return (
          <ModuleFlyout
            module={flyoutModule}
            isActive={isActive}
            top={flyout.top}
            onNavigate={() => setFlyout(null)}
            onClose={() => setFlyout(null)}
          />
        );
      })() : null}
    </aside>
  );
}
