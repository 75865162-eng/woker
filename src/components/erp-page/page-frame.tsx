"use client";

/**
 * 全站统一页面框架（PageFrame）。
 *
 * 融合来源：
 *  - codex/tiaotiao-style-demo（Wimoor Vue 原系统）的 9 类页面模式：面包屑、说明/口径、
 *    状态标签、筛选回显、工具按钮区、合计/统计区、相关页面、详情抽屉。
 *  - wimoor 分支 Next.js 版：多标签页保活（keep-alive 语义）、URL 化筛选、作用域失效。
 *
 * 挂载在 (erp)/layout.tsx 上，因此除 /dashboard 外所有页面（含 43 个 /operations 视图、
 * warehouse / settings / sellfox 的各 tab 与 domain）都自动获得统一布局，无需逐个改 page.tsx。
 * 页面可通过 `usePageStats()` 注入业务 KPI，通过 `PageEvents` 监听刷新/导出动作。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity, BookOpen, ChevronRight, CircleHelp, Copy, Database, Eraser,
  ExternalLink, Layers3, Link2, RefreshCw, ShieldCheck, Sparkles,
} from "lucide-react";
import {
  PAGE_PATTERN_LABELS, resolvePageMeta, type PageCapability, type PageMeta,
} from "@/lib/page/page-meta";
import { operationsSections, OperationsSectionGuide } from "@/components/operations/operations-sections";
import { getPageCacheStats, invalidatePageCache } from "@/lib/page/page-cache";
import { normalizeModuleLabel } from "@/lib/navigation/module-labels";
import { findNavigationModule } from "@/components/app-shell/business-navigation";
import { applyDensity, persistDensity, readDensityPreference } from "@/lib/ui/density";
import { getPageFetchBridgeStats, installPageFetchBridge } from "@/lib/page/page-fetch-bridge";
import { emitPageEvent, PageEvents, usePageEvent } from "@/lib/page/page-bus";
import { ErpBreadcrumbs } from "./erp-breadcrumbs";
import { ErpInfoPanel } from "./erp-info-panel";
import { ErpFilterChips } from "./erp-filter-chips";
import { ErpToolbar } from "./erp-toolbar";
import { ErpStatStrip } from "./erp-stat-strip";
import { ErpStatusTag } from "./erp-status-tag";
import type { ErpAction, ErpBreadcrumb, ErpFilterChip, ErpStat } from "./types";

// ---------------------------------------------------------------------------
// 业务 KPI 注入：工作台可调用 usePageStats().setStats([...]) 把真实指标送到统一统计区。
// ---------------------------------------------------------------------------
type PageStatsContextValue = { stats: ErpStat[]; setStats: (stats: ErpStat[]) => void };
const PageStatsContext = createContext<PageStatsContextValue | null>(null);

export function usePageStats() {
  const value = useContext(PageStatsContext);
  if (!value) return { stats: [] as ErpStat[], setStats: () => {} };
  return value;
}

const STRUCTURAL_PARAMS = new Set([
  "view", "tab", "domain", "adsTab", "page", "pageSize", "size",
  "sort", "order", "sortBy", "sortOrder", "refresh", "replace", "from",
]);

function labelForParam(key: string): string {
  const map: Record<string, string> = {
    q: "关键词", search: "关键词", searchType: "搜索类型", status: "状态",
    site: "站点", shops: "店铺", sku: "SKU", asin: "ASIN", brand: "品牌",
    warehouse: "仓库", supplier: "供应商", dimension: "维度", metric: "指标",
    dateType: "日期类型", from: "起始", to: "截止", currency: "币种",
  };
  return map[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function readChips(params: URLSearchParams): ErpFilterChip[] {
  const chips: ErpFilterChip[] = [];
  params.forEach((value, key) => {
    if (STRUCTURAL_PARAMS.has(key) || !value || key.startsWith("f_")) return;
    if (chips.length >= 12) return;
    chips.push({ key, label: labelForParam(key), value: value.length > 28 ? `${value.slice(0, 28)}…` : value });
  });
  params.forEach((value, key) => {
    if (!key.startsWith("f_") || !value) return;
    if (chips.length >= 12) return;
    chips.push({ key, label: labelForParam(key.slice(2)), value });
  });
  return chips;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * 通用「导出」：把当前视图里最大的表格按可见文本导出为 CSV。
 * 对应 Wimoor 列表页的导出按钮，但不依赖任何页面私有接口，
 * 因此 50 个页面开箱即用；页面若有自己的后端导出，可通过 PageEvents.export 自行接管。
 */
function exportVisibleTable(): number {
  const root = document.querySelector<HTMLElement>("[data-erp-page-body]");
  if (!root) return 0;
  const tables = Array.from(root.querySelectorAll("table"));
  if (!tables.length) return 0;
  const table = tables.reduce((largest, current) =>
    current.querySelectorAll("tr").length > largest.querySelectorAll("tr").length ? current : largest,
  );
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) => Array.from(row.querySelectorAll("th, td"))
      .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()))
    .filter((row) => row.some((cell) => cell !== ""));
  if (!rows.length) return 0;
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `erp-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return Math.max(0, rows.length - 1);
}

function patternTone(pattern: PageMeta["pattern"]): "default" | "brand" | "info" | "success" | "warning" {
  if (pattern === "report" || pattern === "dashboard") return "success";
  if (pattern === "approval" || pattern === "document") return "warning";
  if (pattern === "settings" || pattern === "utility") return "info";
  return "brand";
}

/** 框架自身能保证执行的能力；其余能力交给页面内已有的业务按钮（Wimoor 按钮逻辑融合）。 */
type FrameActionId = "refresh" | "export" | "copy" | "clear" | "info";
const FRAME_CAPABILITY_ACTIONS: Partial<Record<PageCapability, FrameActionId>> = {
  "刷新": "refresh",
  "导出": "export",
  "复制": "copy",
  "重置": "clear",
  "列配置": "info",
  "合计行": "info",
  "状态标签": "info",
  "视图切换": "info",
  "权限校验": "info",
  "多标签保活": "info",
};

/** 在业务内容区按可见文本定位真实按钮，供能力标签直接触发，不改变业务代码。 */
function findBusinessButton(label: string): HTMLElement | null {
  const root = document.querySelector<HTMLElement>("[data-erp-page-body]");
  if (!root) return null;
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("button, [role='button'], a"));
  const exact = candidates.find((element) => (element.textContent ?? "").trim() === label && !element.hasAttribute("disabled"));
  if (exact) return exact;
  return candidates.find((element) => (element.textContent ?? "").trim().includes(label) && !element.hasAttribute("disabled")) ?? null;
}

function flashElement(element: HTMLElement) {
  const previous = element.style.outline;
  element.style.outline = "2px solid var(--color-brand, #2563eb)";
  element.style.outlineOffset = "2px";
  window.setTimeout(() => { element.style.outline = previous; }, 900);
}

export function PageFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const router = useRouter();
  const [stats, setStats] = useState<ErpStat[]>([]);
  const [dense, setDense] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [cacheTick, setCacheTick] = useState(0);
  // 运行时统计只在客户端 effect 后填充，避免 SSR / hydration 首帧不一致。
  const [runtimeStats, setRuntimeStats] = useState<{
    cache: ReturnType<typeof getPageCacheStats>;
    bridge: ReturnType<typeof getPageFetchBridgeStats>;
  } | null>(null);

  const meta = useMemo(() => resolvePageMeta(pathname), [pathname]);
  const viewParam = meta?.viewParam ?? "view";
  const viewKey = searchParams?.get(viewParam) ?? "";
  const declaredView = viewKey ? meta?.views?.[viewKey] : undefined;

  // /operations 的 43 个视图由项目自带的 operationsSections 提供权威的字段/来源/边界说明。
  const operationsEntry = useMemo(() => {
    if (!pathname.startsWith("/operations") || !viewKey) return null;
    for (const section of operationsSections) {
      const entry = section.entries.find((item) => item.view === viewKey);
      if (entry) return { section, entry };
    }
    return null;
  }, [pathname, viewKey]);

  const viewTitle = declaredView?.title ?? operationsEntry?.entry.label ?? (viewKey || "");
  const effectivePattern = declaredView?.pattern ?? meta?.pattern ?? "utility";

  useEffect(() => {
    // 全站默认紧凑密度（14px 基准），用户显式选择「舒适」时才回到 16px。
    setDense(readDensityPreference() !== "comfortable");
  }, []);

  // 密度同时作用于整站排版基准：html font-size 由 data-erp-density 控制。
  useEffect(() => {
    applyDensity(dense ? "dense" : "comfortable");
  }, [dense]);

  // 全站取数 / 缓存融合：把统一基建接到业务工作台的所有直接 fetch 上，卸载时自动还原。
  useEffect(() => installPageFetchBridge(), []);

  // 概览卡展示真实的缓存命中与桥接拦截数据，随缓存失效 / 定时刷新更新。
  useEffect(() => {
    const update = () => setRuntimeStats({
      cache: getPageCacheStats(),
      bridge: getPageFetchBridgeStats(),
    });
    update();
    const timer = window.setInterval(update, 2000);
    return () => window.clearInterval(timer);
  }, [cacheTick]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 工作台或其他页面触发的失效广播，同步刷新状态条。
  usePageEvent(PageEvents.invalidate, () => setCacheTick((value) => value + 1));
  usePageEvent(PageEvents.filterChange, () => setCacheTick((value) => value + 1));

  const showToast = useCallback((message: string) => setToast(message), []);

  const handleRefresh = useCallback(() => {
    invalidatePageCache();
    emitPageEvent(PageEvents.refresh, { pathname, view: viewKey });
    setLastRefreshedAt(Date.now());
    setCacheTick((value) => value + 1);
    showToast("已清除页面缓存并重新取数：服务端数据刷新，订阅刷新事件的列表会重拉");
    router.refresh();
  }, [pathname, viewKey, router, showToast]);

  const handleExport = useCallback(() => {
    // 先广播给有专用后端导出的工作台；页面自带导出按钮优先，避免与 CSV 兜底重复产出。
    emitPageEvent(PageEvents.export, { pathname, view: viewKey });
    const dedicated = findBusinessButton("导出");
    if (dedicated) {
      dedicated.click();
      flashElement(dedicated);
      showToast("已触发当前工作台的专用导出");
      return;
    }
    try {
      const rows = exportVisibleTable();
      showToast(rows > 0
        ? `已导出当前视图 ${rows} 行可见数据（CSV）`
        : "当前视图没有可导出的表格，已向工作台广播导出指令");
    } catch {
      showToast("导出失败，请稍后重试");
    }
  }, [pathname, viewKey, showToast]);

  const handleCopyLink = useCallback(() => {
    const href = window.location.href;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(href).then(
        () => showToast("已复制当前视图链接（含筛选条件）"),
        () => showToast("复制失败，请手动复制地址栏链接"),
      );
    } else {
      showToast("当前浏览器不支持自动复制，请手动复制地址栏链接");
    }
  }, [showToast]);

  const handleClearFilters = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const keep = new URLSearchParams();
    for (const key of ["view", "tab", "domain", "adsTab"]) {
      const value = params.get(key);
      if (value) keep.set(key, value);
    }
    const query = keep.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    emitPageEvent(PageEvents.filterChange, { cleared: true });
    setCacheTick((value) => value + 1);
    showToast("已清除筛选条件，视图已保留");
    router.refresh();
  }, [router, showToast]);

  const handleRemoveChip = useCallback((key: string) => {
    const params = new URLSearchParams(window.location.search);
    params.delete(key);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    emitPageEvent(PageEvents.filterChange, { removed: key });
    setCacheTick((value) => value + 1);
    router.refresh();
  }, [router]);

  const handleDenseChange = useCallback((value: boolean) => {
    setDense(value);
    persistDensity(value ? "dense" : "comfortable");
  }, []);

  /** 能力标签不再是纯文字：能由框架执行的直接执行，其余定位并触发页面内真实业务按钮。 */
  const handleCapability = useCallback((capability: PageCapability) => {
    const frameAction = FRAME_CAPABILITY_ACTIONS[capability];
    if (frameAction === "refresh") { handleRefresh(); return; }
    if (frameAction === "export") { handleExport(); return; }
    if (frameAction === "copy") { handleCopyLink(); return; }
    if (frameAction === "clear") { handleClearFilters(); return; }
    if (frameAction === "info") {
      document.getElementById("erp-page-info")?.scrollIntoView({ behavior: "smooth", block: "start" });
      showToast(`「${capability}」的实现口径见下方页面说明`);
      return;
    }
    const target = findBusinessButton(capability);
    if (target) {
      flashElement(target);
      target.click();
      showToast(`已触发页面「${capability}」入口`);
    } else {
      // 能力已登记但当前 tab / 折叠区未展开时，给出可操作的反馈而不是静默失败。
      document.getElementById("erp-page-info")?.scrollIntoView({ behavior: "smooth", block: "start" });
      showToast(`「${capability}」是本页登记能力，当前视图未展开对应入口，请看下方页面说明`);
    }
  }, [handleRefresh, handleExport, handleCopyLink, handleClearFilters, showToast]);

  if (!meta || meta.skipFrame) return <>{children}</>;

  const chips = readChips(new URLSearchParams(searchParams?.toString() ?? ""));
  const cacheStats = runtimeStats?.cache ?? { hits: 0, misses: 0, size: 0, lastUpdatedAt: null, scope: "default" };
  const bridgeStats = runtimeStats?.bridge;
  const capabilities = meta.capabilities ?? [];
  const related = meta.related ?? [];
  // 面包屑的一级分类以导航配置为准，避免与左侧 11 个一级模块的口径不一致。
  const navModuleLabel = normalizeModuleLabel(findNavigationModule(`${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`)?.label) || normalizeModuleLabel(meta.group);

  const breadcrumbs: ErpBreadcrumb[] = [
    { label: navModuleLabel, href: meta.groupHref },
    { label: meta.title, href: meta.path.endsWith("*") ? undefined : meta.path },
  ];
  if (viewTitle) breadcrumbs.push({ label: viewTitle });

  // 业务注入的真实 KPI 才渲染统计条；框架不再自造「页面模式 / 能力数」概览卡（避免占首屏的低信息卡片）。
  const hasBusinessStats = stats.length > 0;

  const primaryActions: ErpAction[] = [
    { id: "refresh", label: "刷新", icon: RefreshCw, tone: "brand", onClick: handleRefresh },
    { id: "copy", label: "复制视图", icon: Copy, onClick: handleCopyLink },
  ];
  primaryActions.push({
    id: "export", label: "导出", icon: ExternalLink,
    hint: "导出当前视图可见表格为 CSV；页面自带后端导出的会同步收到指令",
    onClick: handleExport,
  });
  const secondaryActions: ErpAction[] = [
    { id: "clear", label: "清除筛选", icon: Eraser, onClick: handleClearFilters, disabled: chips.length === 0 },
    { id: "invalidate", label: "清空页面缓存", icon: Database, onClick: () => { invalidatePageCache(); setCacheTick((v) => v + 1); showToast("已清空全站页面缓存"); } },
    { id: "help", label: "查看布局口径", icon: CircleHelp, onClick: () => document.getElementById("erp-page-info")?.scrollIntoView({ behavior: "smooth", block: "start" }) },
  ];

  return (
    <PageStatsContext.Provider value={{ stats, setStats }}>
      <div className="erp-page-frame flex min-w-0 flex-col gap-2" data-density={dense ? "dense" : "comfortable"} data-cache-revision={cacheTick}>
        {/* 1. 单行页头：面包屑 + 视图标题 + 状态徽章 + 全部工具按钮（原独立工具条卡片并入此处） */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-white px-3 py-1.5">
          <ErpBreadcrumbs items={breadcrumbs} />
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-muted">
            <ErpStatusTag label={PAGE_PATTERN_LABELS[effectivePattern]} tone={patternTone(effectivePattern)} />
            {operationsEntry?.entry.pending ? <ErpStatusTag label="待接入能力" tone="warning" /> : null}
            <span className="inline-flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5" title={meta.cache.strategy}>
              <Database className="h-3 w-3" aria-hidden /> {meta.cache.strategy.split("；")[0]}
            </span>
            {meta.cache.keepAlive ? (
              <span className="inline-flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5" title="多标签页保活，对应原系统 keep-alive">
                <Layers3 className="h-3 w-3" aria-hidden /> 标签保活
              </span>
            ) : null}
            {lastRefreshedAt ? (
              <span className="inline-flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5">
                <Activity className="h-3 w-3" aria-hidden /> {new Date(lastRefreshedAt).toLocaleTimeString("zh-CN", { hour12: false })} 刷新
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5" title={meta.description}>
              能力 {capabilities.length} · 筛选 {chips.length} · 缓存 {cacheStats.hits}/{cacheStats.hits + cacheStats.misses}
              {bridgeStats?.installed ? ` · 桥接拦截 ${bridgeStats.intercepted}` : ""}
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center">
            <ErpToolbar actions={primaryActions} secondaryActions={secondaryActions} dense={dense} onDenseChange={handleDenseChange} />
          </div>
        </div>

        {/* 2. 业务 KPI 统计条（仅当工作台注入真实指标时渲染；紧凑单行卡片） */}
        {hasBusinessStats ? <ErpStatStrip items={stats} columns={4} compact /> : null}

        {/* 3. 已选筛选条件回显 + 本页能力（同一行内回显，避免重复占行） */}
        {(chips.length > 0 || capabilities.length > 0) ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <ErpFilterChips items={chips} onRemove={handleRemoveChip} onClear={chips.length ? handleClearFilters : undefined} />
            {capabilities.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1">
                <span className="mr-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-muted"><Sparkles className="h-3 w-3" aria-hidden /> 能力</span>
                {capabilities.map((capability: PageCapability) => (
                  <button key={capability} type="button" onClick={() => handleCapability(capability)}
                    title={`执行或定位「${capability}」`}
                    className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-brand/10 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                    {capability}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* 4. 页面说明 / 字段口径（默认折叠；/operations 板块说明随展开显示，不再单独占首屏） */}
        <div id="erp-page-info" className="min-w-0">
          <ErpInfoPanel
            title="页面说明与数据口径"
            description={declaredView?.description ?? meta.description}
            bullets={meta.bullets}
            source={declaredView?.source ?? operationsEntry?.section.source ?? meta.source}
            pattern={PAGE_PATTERN_LABELS[effectivePattern]}
            links={related}
            defaultOpen={false}
          >
            {operationsEntry ? <OperationsSectionGuide view={viewKey} /> : null}
          </ErpInfoPanel>
        </div>

        {/* 5. 相关页面快捷入口（单行小 chips） */}
        {related.length > 0 ? (
          <nav aria-label="相关页面" className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted"><Link2 className="h-3 w-3" aria-hidden /> 相关页面</span>
            {related.map((link) => (
              <Link key={link.href} href={link.href} prefetch={false}
                className="inline-flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5 text-[11px] text-brand-dark transition-colors hover:bg-surface-muted">
                {link.label} <ChevronRight className="h-3 w-3" aria-hidden />
              </Link>
            ))}
          </nav>
        ) : null}

        {/* 6. 原页面内容（所有既有 workbench 原样保留） */}
        <div className="min-w-0" data-erp-page-body>
          {children}
        </div>

        {/* 7. 审计标注：让每页的移植依据与缓存口径可见、可验收 */}
        <footer className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-white/60 px-3 py-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" aria-hidden /> 已审计 · {navModuleLabel} / {viewTitle || meta.title} · {PAGE_PATTERN_LABELS[effectivePattern]}</span>
          <span className="inline-flex items-center gap-1"><BookOpen className="h-3 w-3" aria-hidden /> 缓存口径：{meta.cache.strategy}</span>
        </footer>

        {toast ? (
          <div role="status" data-erp-toast="" className="fixed bottom-5 right-5 z-50 rounded-lg border border-border bg-white px-4 py-2.5 text-xs font-medium text-foreground shadow-lg">
            {toast}
          </div>
        ) : null}
      </div>
    </PageStatsContext.Provider>
  );
}
