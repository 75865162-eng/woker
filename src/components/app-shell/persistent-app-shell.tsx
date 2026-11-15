"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppShellClient } from "./app-shell-client";
import { AppShellUserProvider } from "./app-shell-context";
import { setWorkspaceApiCacheScope } from "@/lib/workspace/workspace-api-cache";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import {
  HOME_HREF,
  MAX_TABS,
  WorkspaceTabBar,
  labelForHref,
  normalizeHref,
  splitHref,
  type WorkspaceTab,
} from "./workspace-tabs";

export type AppShellConfiguration = Omit<
  ComponentProps<typeof AppShellClient>,
  "children" | "tabBar" | "contentClassName" | "preserveContent"
> & { authorizationRevision?: string };

const ConfigurationContext = createContext<Dispatch<SetStateAction<AppShellConfiguration>> | null>(null);
const NOOP_CONFIGURATION: Dispatch<SetStateAction<AppShellConfiguration>> = () => {};
const STORAGE_KEY = "woker:workspace-tabs:v2";
const INITIAL_TAB_ID = "tab-initial";
const FRAME_SCOPE_MESSAGE = "woker:workspace-scope-changed";
/** iframe 内页面地址变化时上报给顶层，用来同步侧栏高亮（顶层 URL 不随 iframe 内跳转改变）。 */
const FRAME_HREF_MESSAGE = "woker:frame-href-changed";

type StoredTabs = { tabs: WorkspaceTab[]; activeId: string };

/**
 * 顶层持久外壳 + 顶部多标签。
 *
 * Next.js App Router 的 children 是由路由上下文驱动的 slot，单纯把 RSC 节点缓存起来
 * 并 display:none 并不能保活（切换路由时隐藏页会被重新解析、组件状态丢失）。
 * 因此每个标签用一个同源 iframe 承载完整页面：iframe 拥有独立的路由树和 DOM，
 * 隐藏时用 visibility:hidden 保持挂载，切回来时筛选条件、分页、滚动位置全部原样保留。
 *
 * - 最外层（window.top）：渲染侧边栏 / 顶栏 / 标签栏 + 若干 iframe。
 * - iframe 内（window.self !== window.top）：只渲染页面内容，不再嵌套外壳。
 * - 点击站内链接自动新建标签；切换标签同步 URL；标签清单存 sessionStorage；最多 MAX_TABS 个。
 */
export function PersistentAppShell({ children, initialConfiguration }: {
  children: React.ReactNode;
  initialConfiguration: AppShellConfiguration;
}) {
  const [mode, setMode] = useState<"boot" | "frame" | "top">("boot");
  const cacheScope = `${initialConfiguration.organizationId ?? ""}:${initialConfiguration.userId ?? ""}:${initialConfiguration.userRole ?? ""}:${initialConfiguration.authorizationRevision ?? ""}`;
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();

  useLayoutEffect(() => { setWorkspaceApiCacheScope(cacheScope); }, [cacheScope]);
  useLayoutEffect(() => {
    // iframe 内只渲染页面；useLayoutEffect 在首次绘制前执行，顶层用户不会看到不带外壳的中间态。
    setMode(window.self !== window.top ? "frame" : "top");
  }, []);

  // iframe 内跳转（含页面内部按钮跳转）时把真实地址上报给顶层侧栏。
  const frameSearch = searchParams?.toString() ?? "";
  useEffect(() => {
    if (mode !== "frame") return;
    try {
      window.parent.postMessage(
        { type: FRAME_HREF_MESSAGE, href: `${pathname}${frameSearch ? `?${frameSearch}` : ""}` },
        window.location.origin,
      );
    } catch {
      // 被嵌入到非同源容器时忽略。
    }
  }, [mode, pathname, frameSearch]);

  // 顶层切换工作区时，把事件转发进每个 iframe，让里面的工作台刷新自己的数据。
  useEffect(() => {
    if (mode !== "frame") return;
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const data = event.data as { type?: string; detail?: unknown } | null;
      if (data?.type === FRAME_SCOPE_MESSAGE) {
        window.dispatchEvent(new CustomEvent(workspaceScopeChangedEventName, { detail: data.detail }));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mode]);

  const pageOnly = (
    <AppShellUserProvider value={{
      organizationId: initialConfiguration.organizationId,
      userId: initialConfiguration.userId,
      userName: initialConfiguration.userName,
      userRole: initialConfiguration.userRole,
      rolePermissions: initialConfiguration.rolePermissions,
      userInitials: initialConfiguration.userInitials ?? "AM",
    }}>
      <ConfigurationContext.Provider value={NOOP_CONFIGURATION}>
        <div className="min-h-screen bg-background p-6">{children}</div>
      </ConfigurationContext.Provider>
    </AppShellUserProvider>
  );

  // boot 与 frame 输出一致，保证服务端渲染和水合结果一致。
  if (mode !== "top") return pageOnly;
  return <TabbedErpShell initialConfiguration={initialConfiguration} />;
}

function TabLoading() {
  return (
    <div className="absolute inset-0 z-[2] flex items-center justify-center gap-2 bg-background text-sm text-muted">
      <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      正在打开页面…
    </div>
  );
}

function TabbedErpShell({ initialConfiguration }: { initialConfiguration: AppShellConfiguration }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const queryString = searchParams?.toString() ?? "";
  const currentHref = useMemo(
    () => normalizeHref(`${pathname}${queryString ? `?${queryString}` : ""}`),
    [pathname, queryString],
  );

  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    const { label, locked } = labelForHref(currentHref);
    return [{ id: INITIAL_TAB_ID, href: currentHref, src: currentHref, label, locked }];
  });
  const [activeId, setActiveId] = useState(INITIAL_TAB_ID);
  const [readyIds, setReadyIds] = useState<string[]>([]);
  /** 每个标签 iframe 内部当前真实地址，用于侧栏高亮与标题。 */
  const [frameHrefs, setFrameHrefs] = useState<Record<string, string>>({});

  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  const currentHrefRef = useRef(currentHref);
  const nextIdRef = useRef(1);
  const pendingHrefRef = useRef<string | null>(null);
  const restoredRef = useRef(false);
  const skipPersistRef = useRef(false);
  const frameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});

  tabsRef.current = tabs;
  activeIdRef.current = activeId;
  currentHrefRef.current = currentHref;

  const makeId = useCallback(() => `tab-${Date.now().toString(36)}-${nextIdRef.current++}`, []);

  function dropReady(ids: string[]) {
    if (!ids.length) return;
    setReadyIds((prev) => prev.filter((id) => !ids.includes(id)));
    setFrameHrefs((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
    for (const id of ids) delete frameRefs.current[id];
  }

  const activate = useCallback((id: string, navigate: boolean) => {
    const target = tabsRef.current.find((tab) => tab.id === id);
    if (!target) return;
    if (activeIdRef.current === id && !navigate) return;
    activeIdRef.current = id;
    setActiveId(id);
    if (navigate) {
      pendingHrefRef.current = target.href;
      router.push(target.href);
    }
  }, [router]);

  const ensureTab = useCallback((href: string, linkText?: string) => {
    const normalized = normalizeHref(href);
    const existing = tabsRef.current.find((tab) => tab.href === normalized);
    if (existing) {
      activate(existing.id, false);
      return existing.id;
    }
    const { label, locked } = labelForHref(normalized, linkText);
    const tab: WorkspaceTab = { id: makeId(), href: normalized, src: normalized, label, locked };
    const next = [...tabsRef.current, tab];
    const evicted: string[] = [];
    while (next.length > MAX_TABS) {
      const index = next.findIndex((item) => item.id !== tab.id);
      if (index < 0) break;
      evicted.push(next[index].id);
      next.splice(index, 1);
    }
    if (evicted.length) dropReady(evicted);
    tabsRef.current = next;
    setTabs(next);
    activate(tab.id, false);
    return tab.id;
  }, [activate, makeId]);

  const closeTab = useCallback((id: string) => {
    const current = tabsRef.current;
    const index = current.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const next = current.filter((tab) => tab.id !== id);
    dropReady([id]);
    if (!next.length) {
      const { label, locked } = labelForHref(HOME_HREF);
      const home: WorkspaceTab = { id: makeId(), href: HOME_HREF, src: HOME_HREF, label, locked };
      tabsRef.current = [home];
      setTabs([home]);
      activate(home.id, true);
      return;
    }
    tabsRef.current = next;
    setTabs(next);
    if (activeIdRef.current === id) activate(next[Math.min(index, next.length - 1)].id, true);
  }, [activate, makeId]);

  const closeOthers = useCallback(() => {
    const keep = activeIdRef.current;
    const removed = tabsRef.current.filter((tab) => tab.id !== keep).map((tab) => tab.id);
    const next = tabsRef.current.filter((tab) => tab.id === keep);
    tabsRef.current = next;
    setTabs(next);
    dropReady(removed);
  }, []);

  const closeAll = useCallback(() => {
    const removed = tabsRef.current.map((tab) => tab.id);
    const { label, locked } = labelForHref(HOME_HREF);
    const home: WorkspaceTab = { id: makeId(), href: HOME_HREF, src: HOME_HREF, label, locked };
    tabsRef.current = [home];
    setTabs([home]);
    dropReady(removed);
    activate(home.id, true);
  }, [activate, makeId]);

  const refreshCurrent = useCallback(() => {
    const frame = frameRefs.current[activeIdRef.current];
    try { frame?.contentWindow?.location.reload(); } catch { /* 跨域时忽略 */ }
  }, []);

  // iframe 内地址变化 → 记录到对应标签，侧栏据此高亮/展开。
  useEffect(() => {
    function onFrameHref(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; href?: string } | null;
      if (data?.type !== FRAME_HREF_MESSAGE || typeof data.href !== "string") return;
      const entry = Object.entries(frameRefs.current).find(([, element]) => element?.contentWindow === event.source);
      if (!entry) return;
      const [id] = entry;
      const href = data.href;
      setFrameHrefs((prev) => (prev[id] === href ? prev : { ...prev, [id]: href }));
    }
    window.addEventListener("message", onFrameHref);
    return () => window.removeEventListener("message", onFrameHref);
  }, []);

  // 顶层切换工作区：通知所有已打开的页面，而不是重建 iframe（否则缓存失效）。
  useEffect(() => {
    function forward(event: Event) {
      const detail = (event as CustomEvent).detail;
      for (const frame of Object.values(frameRefs.current)) {
        try { frame?.contentWindow?.postMessage({ type: FRAME_SCOPE_MESSAGE, detail }, "*"); } catch { /* ignore */ }
      }
    }
    window.addEventListener(workspaceScopeChangedEventName, forward);
    return () => window.removeEventListener(workspaceScopeChangedEventName, forward);
  }, []);

  // 标签切换 / 新建标签后把顶层地址收敛到当前标签：
  // activate() 里的 router.push 与 setActiveId 同批更新时可能被 React 的紧急更新打断，
  // 放到 effect 里重试更稳定，保证地址栏、刷新恢复与复制链接都指向正在看的页面。
  useEffect(() => {
    const tab = tabsRef.current.find((item) => item.id === activeIdRef.current);
    if (!tab || tab.href === currentHrefRef.current) return;
    router.replace(tab.href);
  }, [activeId, router, currentHref]);

  // 刷新浏览器后恢复标签清单；页面内容由各 iframe 自行加载。
  useLayoutEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredTabs;
      const stored = (Array.isArray(parsed.tabs) ? parsed.tabs : [])
        .filter((tab): tab is WorkspaceTab => Boolean(tab && typeof tab.href === "string" && typeof tab.label === "string" && typeof tab.id === "string"))
        .map((tab) => ({ ...tab, src: typeof tab.src === "string" && tab.src ? tab.src : tab.href }))
        .slice(0, MAX_TABS);
      if (!stored.length) return;
      skipPersistRef.current = true;
      const next = [...stored];
      let active = next.find((tab) => tab.href === currentHref);
      if (!active) {
        const { label, locked } = labelForHref(currentHref);
        active = { id: makeId(), href: currentHref, src: currentHref, label, locked };
        next.push(active);
      }
      tabsRef.current = next;
      setTabs(next);
      activeIdRef.current = active.id;
      setActiveId(active.id);
    } catch {
      // 本地数据损坏时保持初始标签即可。
    }
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId } satisfies StoredTabs));
    } catch { /* 隐私模式下忽略 */ }
  }, [tabs, activeId]);

  // 站内链接点击：在 Next 导航生效前先建好标签。
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (window.self !== window.top) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const raw = anchor.getAttribute("href");
      if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return;
      let href: string;
      try {
        const url = new URL(raw, window.location.href);
        if (url.origin !== window.location.origin) return;
        href = url.pathname + url.search;
      } catch { return; }
      const path = splitHref(href).pathname;
      if (path.startsWith("/api/") || path.startsWith("/_next/") || path === "/login" || path === "/logout" || /\.[a-z0-9]+$/i.test(path)) return;
      if (href === currentHrefRef.current) return;
      pendingHrefRef.current = normalizeHref(href);
      ensureTab(href, anchor.textContent ?? undefined);
    }
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [ensureTab]);

  // 浏览器前进后退、代码里 router.push 等未经过链接点击的路由变化。
  useEffect(() => {
    const pending = pendingHrefRef.current;
    pendingHrefRef.current = null;
    if (pending === currentHref) return;

    const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
    if (!active || active.href === currentHref) return;

    const existing = tabsRef.current.find((tab) => tab.href === currentHref);
    if (existing) {
      activate(existing.id, false);
      return;
    }
    if (splitHref(currentHref).pathname === splitHref(active.href).pathname) {
      const next = tabsRef.current.map((tab) => (tab.id === active.id ? { ...tab, href: currentHref } : tab));
      tabsRef.current = next;
      setTabs(next);
      return;
    }
    ensureTab(currentHref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHref]);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  // 优先使用 iframe 内部真实地址，保证「页面内跳转」后侧栏高亮、自动展开与标题都正确。
  const activeFrameHref = activeTab ? frameHrefs[activeTab.id] ?? activeTab.href : currentHref;
  const activeFrameLabel = activeTab && activeFrameHref !== activeTab.href ? labelForHref(activeFrameHref) : null;
  const headerTitle = activeFrameLabel?.locked ? activeFrameLabel.label : activeTab?.label ?? initialConfiguration.title;
  const frames: ReactNode[] = tabs.map((tab) => {
    const isActive = tab.id === activeTab?.id;
    const ready = readyIds.includes(tab.id);
    return (
      <div
        key={tab.id}
        className="absolute inset-0"
        style={{
          visibility: isActive && ready ? "visible" : "hidden",
          pointerEvents: isActive ? "auto" : "none",
          zIndex: isActive ? 1 : -1,
        }}
      >
        <iframe
          ref={(element) => {
            if (element) frameRefs.current[tab.id] = element;
            else delete frameRefs.current[tab.id];
          }}
          src={tab.src}
          title={tab.label}
          data-workspace-frame={tab.id}
          onLoad={() => setReadyIds((prev) => (prev.includes(tab.id) ? prev : [...prev, tab.id]))}
          className="h-full w-full border-0 bg-background"
        />
      </div>
    );
  });

  return (
    <AppShellClient
      {...initialConfiguration}
      title={headerTitle}
      currentHref={activeFrameHref}
      tabBar={
        <WorkspaceTabBar
          tabs={tabs}
          activeId={activeId}
          cachedIds={readyIds}
          onSelect={(id) => activate(id, true)}
          onClose={closeTab}
          onRefresh={refreshCurrent}
          onCloseOthers={closeOthers}
          onCloseAll={closeAll}
        />
      }
      contentClassName="p-0"
      preserveContent
    >
      <div className="relative h-[calc(100vh-96px)] min-h-[420px] w-full overflow-hidden bg-background">
        {frames}
        {!readyIds.includes(activeTab?.id ?? "") ? <TabLoading /> : null}
      </div>
    </AppShellClient>
  );
}

// Page authorization still runs on the server for every new page request.
// Only the display configuration changes; the sidebar, workspace and notification owners persist.
export function AppShellPage({ children, configuration }: {
  children: React.ReactNode;
  configuration: AppShellConfiguration;
}) {
  const setConfiguration = useContext(ConfigurationContext);
  if (!setConfiguration) throw new Error("Business pages must use the persistent ERP layout.");
  useLayoutEffect(() => { setConfiguration(configuration); }, [configuration, setConfiguration]);
  return children;
}
