"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ContextType,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AppShellClient } from "./app-shell-client";
import { TabActivityProvider, useTabActive } from "./tab-activity";
import { setWorkspaceApiCacheScope } from "@/lib/workspace/workspace-api-cache";
import { prefetchRouteData } from "@/lib/workspace/route-data-prefetch";
import { bumpShellCause, captureTabEvent, diagRefId, installTabDiagnostics } from "@/lib/app-shell/tab-navigation-diagnostics";
import {
  HOME_HREF,
  MAX_TABS,
  MAX_VIEWS,
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
type RegisterPage = (href: string, element: ReactNode, configuration: AppShellConfiguration, context: SegmentContext) => void;
const PageRegistrationContext = createContext<RegisterPage | null>(null);
/** dev-only：AppShellPage 全局渲染序号，用于定位 configuration 回写风暴。 */
let appShellRenderSeq = 0;
const STORAGE_KEY = "woker:workspace-tabs:v3";
const PREFETCH_DELAY_MS = 60;
/** 页面稳定多久之后开始预热同组路由：太早会和首屏自己的请求抢带宽。 */
const IDLE_PREFETCH_DELAY_MS = 1200;

type StoredTabs = { tabs: WorkspaceTab[] };

/** `(erp)` 这一层的路由分段上下文，决定「children 现在解析成哪个页面」。 */
type SegmentContext = ContextType<typeof LayoutRouterContext>;

/**
 * 一个被保活的页面。
 *
 * `element` 是它当初的 RSC 子树，`context` 是同一时刻的路由分段上下文——两者必须成对保存：
 * App Router 的 `children` 本身不带「我是哪个页面」的信息，它靠 `LayoutRouterContext` 里的
 * `parentTree` 现场解析当前分段。只留 element 会让隐藏的视图跟着当前地址一起变；
 * 连同上下文一起冻住，它才稳定渲染自己那一段。`seq` 用来做 LRU 排序。
 *
 * 注意：`LayoutRouterContext` 是 Next 的内部模块（`next/dist/shared/lib/app-router-context`），
 * 在 15.5.x 上验证有效；升级 Next 后需要复核这条保活路径（页面若整片渲染成当前路由就是它失效了）。
 */
export type CachedView = { href: string; element: ReactNode; context: SegmentContext; seq: number };

/**
 * 单文档多标签外壳。
 *
 * 标签栏是「访问过的页面」的索引，页面本身由 Next 客户端路由渲染在同一份 document 里：
 * 没有 iframe，也就没有「每开一个标签重新下载一遍整个应用」的成本。
 *
 * 页面状态按三层保住，越靠前越快、越靠后越省内存：
 * 1. **保活视图**：访问过的页面留在 React 树里（隐藏但不卸载），切回来组件状态原样还在，
 *    切换开销只有一次 display 切换。数量受 MAX_VIEWS 约束，超出按 LRU 淘汰最久没打开的。
 * 2. **查询缓存**：`/api/operations/ext` 的结果进 LRU + SWR 缓存，被淘汰的页面重新挂载时
 *    先用缓存出内容，再后台校验，不会闪空。
 * 3. **提前预取**：指针停在链接上就拉目标路由的 RSC 与首屏查询，点击时大多已经就绪。
 *
 * 内存方面：保活的视图只保留「状态」，不保留重内容——长列表在标签转入后台时释放行级 DOM
 * （见 `useTabActive`），回到前台按原状态重建。
 */
export function WorkspaceShell({ children, configuration }: {
  children: ReactNode;
  configuration: AppShellConfiguration;
}) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const queryString = useSearchParams()?.toString() ?? "";
  const currentHref = useMemo(
    () => normalizeHref(`${pathname}${queryString ? `?${queryString}` : ""}`),
    [pathname, queryString],
  );

  const [display, setDisplay] = useState<AppShellConfiguration>(configuration);
  // 当前分段的路由上下文：视图登记时一并快照，隐藏视图靠它固定住自己的页面。
  const segmentContext = useContext(LayoutRouterContext);
  if (process.env.NODE_ENV !== "production") {
    captureTabEvent({
      t: "shellrender", at: Date.now(),
      childrenId: diagRefId(children), segmentContextId: diagRefId(segmentContext),
      configurationId: diagRefId(configuration), displayId: diagRefId(display),
      views: 0, tabs: 0,
    });
  }
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    const { label, locked } = labelForHref(currentHref);
    return [{ id: currentHref, href: currentHref, src: currentHref, label, locked }];
  });
  // 当前分段的路由上下文：视图登记时一并快照，隐藏视图靠它固定住自己的页面。
  const [views, setViews] = useState<CachedView[]>([]);
  const [restored, setRestored] = useState(false);
  // 当前展示的视图严格跟随真实路由。此前这里叠加了一层"乐观切换"（pendingHref）：
  // 点击已保活链接时先手动切换视图、再后台 router.push。连续快速切换时，Next 会把
  // 过渡中的 push 合并/丢弃，currentHref 停在旧值，而乐观视图已经切走，两者脱节后
  // 页面会永久卡住（刷新才恢复）。导航交给 Next 的 <Link> 原生处理后不再需要这一层。
  const shownHref = currentHref;

  const currentHrefRef = useRef(currentHref);
  const tabsRef = useRef(tabs);
  const usedAtRef = useRef(new Map<string, number>());
  const scrollRef = useRef(new Map<string, number>());
  /** 正在恢复滚动位置的窗口期内，忽略由布局收缩产生的 scroll 事件。 */
  const restoringRef = useRef(false);
  const shownHrefRef = useRef(shownHref);
  const seqRef = useRef(0);
  currentHrefRef.current = currentHref;
  tabsRef.current = tabs;
  shownHrefRef.current = shownHref;

  // dev-only 诊断探针：安装全局监听（异常/长任务/fetch/heap），生产环境为 no-op。
  useEffect(() => installTabDiagnostics(), []);

  useLayoutEffect(() => {
    setWorkspaceApiCacheScope(`${configuration.organizationId ?? ""}:${configuration.userId ?? ""}:${configuration.userRole ?? ""}:${configuration.authorizationRevision ?? ""}`);
  }, [configuration]);

  const touch = useCallback((href: string) => {
    usedAtRef.current.set(href, ++seqRef.current);
  }, []);

  // 超过上限时按标签打开顺序淘汰最早的标签（当前页和刚打开的除外）。
  const appendTab = useCallback((prev: WorkspaceTab[], tab: WorkspaceTab) => {
    const next = [...prev, tab];
    while (next.length > MAX_TABS) {
      const victim = next.findIndex((candidate) => candidate.id !== tab.id && candidate.href !== currentHrefRef.current);
      if (victim < 0) break;
      next.splice(victim, 1);
    }
    return next;
  }, []);

  // 刷新浏览器后恢复标签清单；当前地址必须在列表里。
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as StoredTabs).tabs : [];
      const valid = Array.isArray(stored)
        ? stored
            .filter((tab): tab is WorkspaceTab => Boolean(tab && typeof tab.href === "string" && typeof tab.label === "string"))
            .map((tab) => ({ ...tab, id: tab.href, src: tab.href }))
            .slice(-MAX_TABS)
        : [];
      const href = currentHrefRef.current;
      if (!valid.some((tab) => tab.href === href)) {
        if (valid.length >= MAX_TABS) valid.splice(0, valid.length - MAX_TABS + 1);
        const { label, locked } = labelForHref(href);
        valid.push({ id: href, href, src: href, label, locked });
      }
      setTabs(valid);
    } catch {
      // 本地数据损坏时保留初始标签即可。
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs } satisfies StoredTabs));
    } catch { /* 隐私模式下忽略 */ }
  }, [tabs, restored]);

  // 地址变化（标签点击、浏览器前进后退、代码里的 router.push）统一同步进标签栏。
  useEffect(() => {
    if (!restored) return;
    captureTabEvent({ t: "route", at: Date.now(), href: currentHref, phase: "start" });
    // 路由稳定后记一条 end：不阻塞导航，纯观察。
    const endTimer = window.setTimeout(() => {
      captureTabEvent({ t: "route", at: Date.now(), href: currentHref, phase: "end" });
    }, 0);
    touch(currentHref);
    setTabs((prev) => {
      if (prev.some((tab) => tab.href === currentHref)) return prev;
      const { label, locked } = labelForHref(currentHref);
      return appendTab(prev, { id: currentHref, href: currentHref, src: currentHref, label, locked });
    });
    return () => window.clearTimeout(endTimer);
  }, [currentHref, restored, touch, appendTab]);

  const viewsRef = useRef(views);
  viewsRef.current = views;
  // Cache page content, never Next's live LayoutRouter element. A hidden router
  // can issue stale server patches and prevent the next navigation committing.
  const registerPage = useCallback<RegisterPage>((href, element, pageConfiguration, context) => {
    setViews(prev => upsertView(prev, href, <AppShellPage configuration={pageConfiguration}>{element}</AppShellPage>, context));
  }, []);
  const syncedViews = views;
  // Keep the registered page content while correcting a context captured during navigation.
  useEffect(() => {
    const current = viewsRef.current.find(view => view.href === currentHref);
    if (!current || current.context === segmentContext) return;
    setViews(previous => previous.map(view => view.href === currentHref ? { ...view, context: segmentContext } : view));
  }, [currentHref, segmentContext]);

  // 只渲染仍在标签栏里的视图；被关掉或被标签上限挤掉的视图顺带释放。
  const renderedViews = syncedViews.filter(
    (view) => view.href === currentHref || view.href === shownHref || tabs.some((tab) => tab.href === view.href),
  );

  // 记住每个标签的滚动位置：隐藏视图是 display:none，滚动位置不会自己留下来。
  useEffect(() => {
    let frame = 0;
    function onScroll() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        // 切换过程中隐藏当前视图会让文档高度骤减，浏览器会把 scrollY 归 0，
        // 这个由布局收缩引起的滚动事件不能写进缓存，否则被切走的页面会记住 0。
        if (restoringRef.current) return;
        scrollRef.current.set(shownHrefRef.current, window.scrollY);
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    const target = scrollRef.current.get(shownHref) ?? 0;
    restoringRef.current = true;
    window.scrollTo(0, target);
    // 缓存视图重新显示时内容高度可能晚一帧才稳定（表格、图片），补两次 rAF 再解除屏蔽。
    const frames: number[] = [];
    frames.push(window.requestAnimationFrame(() => {
      window.scrollTo(0, target);
      frames.push(window.requestAnimationFrame(() => {
        restoringRef.current = false;
        scrollRef.current.set(shownHref, window.scrollY);
      }));
    }));
    return () => {
      frames.forEach((id) => window.cancelAnimationFrame(id));
      restoringRef.current = false;
    };
  }, [shownHref]);

  const closeTab = useCallback((id: string) => {
    const current = tabsRef.current;
    const index = current.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    setViews((prev) => prev.filter((view) => view.href !== id));
    scrollRef.current.delete(id);
    const next = current.filter((tab) => tab.id !== id);
    if (!next.length) {
      const { label, locked } = labelForHref(HOME_HREF);
      setTabs([{ id: HOME_HREF, href: HOME_HREF, src: HOME_HREF, label, locked }]);
      usedAtRef.current.delete(HOME_HREF);
      router.push(HOME_HREF, { scroll: false });
      return;
    }
    setTabs(next);
    if (id === currentHrefRef.current) {
      scrollRef.current.set(shownHrefRef.current, window.scrollY);
      router.push(next[Math.min(index, next.length - 1)].href, { scroll: false });
    }
  }, [router]);

  const closeOthers = useCallback(() => {
    const keep = currentHrefRef.current;
    setTabs((prev) => prev.filter((tab) => tab.href === keep));
    setViews((prev) => prev.filter((view) => view.href === keep));
  }, []);

  const closeAll = useCallback(() => {
    const { label, locked } = labelForHref(HOME_HREF);
    setTabs([{ id: HOME_HREF, href: HOME_HREF, src: HOME_HREF, label, locked }]);
    setViews([]);
    usedAtRef.current.clear();
    scrollRef.current.clear();
    router.push(HOME_HREF, { scroll: false });
  }, [router]);

  const refreshCurrent = useCallback(() => { router.refresh(); }, [router]);

  // 悬停只预热首屏「数据」（进页面后 useExt 直接命中缓存），不触发任何 RSC 预取。
  // 本应用把访问过的页面保活但隐藏，隐藏视图里的 <Link> 仍在视口内会批量发起
  // Next 默认 RSC 预取；用户快速点击时导航请求被这些预取 abort，页面卡死、刷新才恢复。
  // 因此导航 Link 一律 prefetch={false}，RSC 预取彻底关闭，只保留这里的数据级预热。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingHref: string | null = null;
    function handleOver(event: Event) {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = internalHrefFromAnchor(anchor);
      if (!href || href === currentHrefRef.current || href === pendingHref) return;
      pendingHref = href;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        prefetchRouteData(href);
      }, PREFETCH_DELAY_MS);
    }
    document.addEventListener("pointerover", handleOver, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("pointerover", handleOver);
    };
  }, []);

  // 空闲预热同组页面的「首屏数据」（不是 RSC）。不做任何 router.prefetch / RSC 预取：
  // 它们会在连续点击时与目标导航的 RSC 请求并发、互相 abort，导致页面卡死。
  // 这里只保留数据级预热，安全且与导航互不干扰。
  useEffect(() => {
    if (!restored) return;
    let cancelled = false;
    const timers: number[] = [];
    const kickoff = window.setTimeout(() => {
      if (cancelled || document.visibilityState !== "visible") return;
      const section = Array.from(document.querySelectorAll("aside section"))
        .find((item) => item.querySelector('a[aria-current="page"]'));
      if (!section) return;
      const anchors = Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href^="/"]'));
      const activeIndex = anchors.findIndex((anchor) => anchor.getAttribute("aria-current") === "page");
      const targets = anchors
        .map((anchor, index) => ({ href: internalHrefFromAnchor(anchor), index }))
        .filter((item): item is { href: string; index: number } => Boolean(item.href) && item.href !== currentHrefRef.current)
        .filter((item) => !viewsRef.current.some((view) => view.href === item.href))
        .sort((a, b) => Math.abs(a.index - activeIndex) - Math.abs(b.index - activeIndex))
        .slice(0, 8)
        .map((item) => item.href);
      targets.forEach((href, index) => {
        timers.push(window.setTimeout(() => {
          if (cancelled) return;
          prefetchRouteData(href);
        }, index * 250));
      });
    }, IDLE_PREFETCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(kickoff);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [currentHref, restored]);

  const activeTab = tabs.find((tab) => tab.href === shownHref) ?? tabs.find((tab) => tab.id === shownHref);

  return (
    <ConfigurationContext.Provider value={setDisplay}>
      <PageRegistrationContext.Provider value={registerPage}>
        <div hidden>{children}</div>
      </PageRegistrationContext.Provider>
      <AppShellClient
        {...display}
        title={display.title ?? activeTab?.label ?? configuration.title}
        tabBar={
          <WorkspaceTabBar
            tabs={tabs}
            activeId={activeTab?.id ?? shownHref}
            cachedIds={renderedViews.map((view) => view.href)}
            onSelect={(id) => {
              const target = tabsRef.current.find((tab) => tab.id === id);
              captureTabEvent({ t: "click", at: Date.now(), target: target?.href ?? id, tabs: tabsRef.current.length, activeId: shownHrefRef.current });
              if (!target || target.href === shownHrefRef.current) return;
              scrollRef.current.set(shownHrefRef.current, window.scrollY);
              // 导航交给 Next 的路由，视图由 currentHref 驱动；不再乐观切换，
              // 避免连续切标签时 shownHref 与 currentHref 脱节导致页面卡住。
              router.push(target.href, { scroll: false });
            }}
            onClose={closeTab}
            onRefresh={refreshCurrent}
            onCloseOthers={closeOthers}
            onCloseAll={closeAll}
          />
        }
        preserveContent
      >
        {renderedViews.map((view) => (
          <KeptView
            key={view.href}
            href={view.href}
            visible={view.href === shownHref}
            element={view.element}
            context={view.context}
          />
        ))}
      </AppShellClient>
    </ConfigurationContext.Provider>
  );
}

/**
 * 一个被保活的页面容器。
 *
 * `memo` 是这里的关键：打开第三个、第五个标签时外壳会因为 tabs/views 变化重渲染，
 * 但已经保活的那几页 props 一个都没变（element 是它当初的 RSC 子树、context 是快照），
 * 于是直接跳过调和。没有这层 memo，每开一个标签都要把所有老页面重新 patch 一遍，
 * 标签越多越慢——这正是「第三个标签特别慢」的放大器。
 */
const KeptView = memo(function KeptView({ href, visible, element, context }: {
  href: string;
  visible: boolean;
  element: ReactNode;
  context: SegmentContext;
}) {
  // 隐藏视图必须看到「自己那一页」的地址：否则它订阅的是当前路由，
  // 每次切标签都会被牵动重渲染并重发自己的查询（实测同一条 sync-center 查询会重复 2–4 次）。
  const { pathname, search } = splitHref(href);
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const diagRenderRef = useRef(0);
  const diagKey = href;
  if (process.env.NODE_ENV !== "production") {
    diagRenderRef.current += 1;
    captureTabEvent({ t: "render", at: Date.now(), href: diagKey, count: diagRenderRef.current });
    captureTabEvent({
      t: "viewsig", at: Date.now(), href: diagKey,
      elementId: diagRefId(element), contextId: diagRefId(context), visible,
    });
  }
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    captureTabEvent({ t: "mount", at: Date.now(), href: diagKey, count: 1 });
    return () => { captureTabEvent({ t: "unmount", at: Date.now(), href: diagKey, count: 1 }); };
  }, [diagKey]);
  return (
    <TabActivityProvider value={visible}>
      <LayoutRouterContext.Provider value={context}>
        <PathnameContext.Provider value={pathname}>
          <SearchParamsContext.Provider value={searchParams}>
            <div hidden={!visible} data-workspace-view={href}>
              {element}
            </div>
          </SearchParamsContext.Provider>
        </PathnameContext.Provider>
      </LayoutRouterContext.Provider>
    </TabActivityProvider>
  );
});

/**
 * 登记/更新一个视图并做 LRU 淘汰。
 * `seq` 由现有视图的最大值推出来，函数本身是纯的，重复调用结果一致（渲染期同步 state 要求这点）。
 */
export function upsertView(views: CachedView[], href: string, element: ReactNode, context: SegmentContext): CachedView[] {
  const seq = views.reduce((max, view) => Math.max(max, view.seq), 0) + 1;
  const index = views.findIndex((view) => view.href === href);
  const next: CachedView[] = index >= 0
    ? views.map((view, position) => (position === index ? { href, element, context, seq } : view))
    : [...views, { href, element, context, seq }];

  if (next.length <= MAX_VIEWS) return next;
  const evicted = new Set(
    next
      .filter((view) => view.href !== href)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, next.length - MAX_VIEWS)
      .map((view) => view.href),
  );
  return next.filter((view) => !evicted.has(view.href));
}

/** 把站内 <a> 归一化成标签身份；站外链接、下载、API 与登录页一律返回 null。 */
function internalHrefFromAnchor(anchor: HTMLAnchorElement): string | null {
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  const raw = anchor.getAttribute("href");
  if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return null;
  let href: string;
  try {
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return null;
    href = url.pathname + url.search;
  } catch {
    return null;
  }
  const path = splitHref(href).pathname;
  if (path.startsWith("/api/") || path.startsWith("/_next/") || path === "/login" || path === "/HKQ" || path === "/tiaotiao" || path === "/logout" || /\.[a-z0-9]+$/i.test(path)) return null;
  return normalizeHref(href);
}

// 页面的 title / subtitle / actions 通过这里回填到顶栏，只改显示配置，不重建外壳。
// 隐藏的标签不抢顶栏：只有在前台时才写配置，切回来时再补一次。
export function AppShellPage({ children, configuration }: {
  children: React.ReactNode;
  configuration: AppShellConfiguration;
}) {
  const setConfiguration = useContext(ConfigurationContext);
  const registerPage = useContext(PageRegistrationContext);
  const pathname = usePathname() || "/";
  const search = useSearchParams()?.toString() ?? "";
  const href = normalizeHref(`${pathname}${search ? `?${search}` : ""}`);
  const segmentContext = useContext(LayoutRouterContext);
  useLayoutEffect(() => {
    registerPage?.(href, children, configuration, segmentContext);
  }, [registerPage, href, children, configuration, segmentContext]);
  const active = useTabActive();
  if (process.env.NODE_ENV !== "production") {
    appShellRenderSeq += 1;
    captureTabEvent({
      t: "appshellrender", at: Date.now(),
      key: String(configuration.title ?? "?"), count: appShellRenderSeq,
      configId: diagRefId(configuration),
    });
  }
  useLayoutEffect(() => {
    if (active) {
      if (process.env.NODE_ENV !== "production") bumpShellCause("setConfig");
      setConfiguration?.(configuration);
    }
  }, [active, configuration, setConfiguration]);
  if (!setConfiguration) throw new Error("Business pages must use the persistent ERP layout.");
  return registerPage ? null : children;
}
