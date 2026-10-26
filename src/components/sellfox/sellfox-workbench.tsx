"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, RefreshCw, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { sellfoxDateAt, sellfoxSyncDisabledReason } from "@/lib/sellfox/sync-contract";
import { backfillSellfoxViewDates, defaultSellfoxView, readSellfoxView, sellfoxDomains, sellfoxViewParams, type SellfoxView } from "@/lib/sellfox/workbench-view";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { SellfoxConnectionBar } from "./connection-bar";
import { SellfoxBrowseFilters } from "./browse-filters";
import { SellfoxDomainTabs } from "./domain-tabs";
import { SellfoxResourceTable } from "./resource-table";
import { SellfoxRecentRuns, SellfoxSyncRunsPanel } from "./sync-runs-panel";
import { SellfoxRecordDetail } from "./record-detail";
import { browseEmptyMessage, defaultVisibleColumnKeys, resourceLabels, type Overview, type Pagination, type Row, type Schedule } from "./workbench-types";

function readScope() {
  try { return normalizeWorkspaceScope(JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}")); }
  catch { return normalizeWorkspaceScope(); }
}
function resourceForDomain(domain: SellfoxView["domain"]) { return domain === "ads" ? "ads_report" : ["inventory", "sales", "performance", "listings"].includes(domain) ? domain : "stores"; }
function endpoint(domain: SellfoxView["domain"]) { return `/api/sellfox/${domain === "ads" ? "ads_report" : domain}`; }

export function SellfoxWorkbench() {
  const shellUser = useAppShellUser();
  const canSync = roleCanPerformAction(shellUser?.userRole, "sellfox", "create", shellUser?.rolePermissions);
  const canExport = roleCanPerformAction(shellUser?.userRole, "sellfox", "export", shellUser?.rolePermissions);
  const [view, setView] = useState(defaultSellfoxView); const [scope, setScope] = useState(normalizeWorkspaceScope());
  const [ready, setReady] = useState(false); const scopeEpoch = useRef(0);
  const [overview, setOverview] = useState<Overview | null>(null); const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [rows, setRows] = useState<Row[]>([]); const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0 });
  const [selectedRow, setSelectedRow] = useState<Row | null>(null); const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false); const [scheduleWorking, setScheduleWorking] = useState(false);
  const [syncResource, setSyncResource] = useState("stores"); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const [dates, setDates] = useState<string[]>([]); const [totals, setTotals] = useState<Row[]>([]);
  const [productTags, setProductTags] = useState<string[]>([]);
  const [columnSelection, setColumnSelection] = useState<Record<string, string[]>>({});
  // Explicit choices belong to this dimension, including back/forward navigation.
  const columnSelectionKey = ["sales", "performance"].includes(view.domain) ? `${view.domain}:${view.dimension}` : view.domain;
  const [backfillStart, setBackfillStart] = useState("");
  const [overviewError, setOverviewError] = useState(""); const [refreshVersion, setRefreshVersion] = useState(0);
  const headers = useMemo(() => ({ "x-workspace-id": scope.workspaceId, ...(scope.accountId ? { "x-account-id": scope.accountId } : {}), ...(scope.marketplace ? { "x-marketplace": scope.marketplace } : {}) }), [scope]);
  const withScope = useCallback((params: URLSearchParams) => {
    params.set("workspaceId", scope.workspaceId);
    if (scope.accountId) params.set("accountId", scope.accountId);
    if (scope.marketplace) params.set("marketplace", scope.marketplace);
    return params;
  }, [scope]);

  useEffect(() => {
    const initial = readSellfoxView(new URLSearchParams(window.location.search));
    setScope(readScope()); setView(initial); setSyncResource(resourceForDomain(initial.domain)); setReady(true);
    const pop = () => { setView(readSellfoxView(new URLSearchParams(window.location.search))); setSelectedRow(null); setRows([]); setDates([]); setTotals([]); setProductTags([]); setPagination({ page: 1, pageSize: 20, total: 0 }); setError(""); };
    const changed = () => {
      scopeEpoch.current += 1; setScope(readScope()); setBackfillStart(""); setOverview(null); setSchedules([]); setRows([]); setDates([]); setTotals([]); setProductTags([]); setSelectedRow(null);
      setPagination({ page: 1, pageSize: 20, total: 0 }); setError(""); setOverviewError(""); setNotice(""); setWorking(false); setScheduleWorking(false); setLoading(true);
      const next = { ...readSellfoxView(new URLSearchParams(window.location.search)), shops: [], site: "", page: 1 };
      setView(next);
      const params = sellfoxViewParams(next); params.set("workspaceId", readScope().workspaceId);
      window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    };
    window.addEventListener("popstate", pop); window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => { scopeEpoch.current += 1; window.removeEventListener("popstate", pop); window.removeEventListener(workspaceScopeChangedEventName, changed); };
  }, []);

  function navigate(patch: Partial<SellfoxView>, replace = false) {
    const next = { ...view, page: 1, ...(patch.domain && patch.domain !== view.domain ? { searchType: "" } : {}), ...patch }; setView(next); setSelectedRow(null); setRows([]); setDates([]); setTotals([]); setProductTags([]); setPagination({ page: next.page, pageSize: next.pageSize ?? 20, total: 0 }); setLoading(true); setError("");
    const url = `${window.location.pathname}?${withScope(sellfoxViewParams(next))}`;
    if (replace) window.history.replaceState(null, "", url); else window.history.pushState(null, "", url);
  }

  const pollOverview = view.domain === "runs" || Boolean(overview?.latestRuns.some((run) => ["queued", "running"].includes(run.status)));

  // Overview, schedules, table polling, raw details and mutation completions all
  // belong to one captured workspace. Abort plus epoch checks cover late responses.
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); const epoch = scopeEpoch.current; let canceled = false; let inFlight = false;
    async function load() {
      if (inFlight) return; inFlight = true;
      try {
        const [response, scheduleResponse] = await Promise.all([
          fetch("/api/sellfox/overview", { headers, cache: "no-store", signal: controller.signal }),
          fetch("/api/sellfox/schedules", { headers, cache: "no-store", signal: controller.signal }),
        ]);
        const data = await response.json(); const scheduleData = await scheduleResponse.json();
        if (!response.ok) throw new Error(data.error || "读取赛狐概览失败。");
        if (!scheduleResponse.ok) throw new Error(scheduleData.error || "读取定时计划失败。");
        if (!canceled && scopeEpoch.current === epoch) { setOverview(data); setSchedules(scheduleData.schedules ?? []); setOverviewError(""); }
      } catch (cause) { if (!canceled && scopeEpoch.current === epoch) setOverviewError(cause instanceof Error ? cause.message : "读取赛狐概览失败。"); }
      finally { inFlight = false; }
    }
    void load(); const timer = pollOverview ? window.setInterval(() => void load(), 15_000) : undefined;
    return () => { canceled = true; controller.abort(); if (timer) window.clearInterval(timer); };
  }, [ready, headers, refreshVersion, pollOverview]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); const epoch = scopeEpoch.current; let canceled = false; let inFlight = false;
    setLoading(true); setError("");
    async function load() {
      if (inFlight) return; inFlight = true;
      try {
        if (view.domain === "overview") return;
        const response = await fetch(`${endpoint(view.domain)}?${withScope(sellfoxViewParams(view, true))}`, { headers, cache: "no-store", signal: controller.signal });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "读取赛狐数据失败。");
        if (!canceled && scopeEpoch.current === epoch) {
          setProductTags(data.facets?.productTags ?? []); setRows(data.rows ?? []); setDates(data.dates ?? []); setTotals(data.totals ?? []); setPagination(data.pagination ?? { page: view.page, pageSize: 20, total: 0 });
          const resolved = backfillSellfoxViewDates(view, data.dates);
          if (resolved !== view) {
            setView(resolved);
            window.history.replaceState(null, "", `${window.location.pathname}?${withScope(sellfoxViewParams(resolved))}`);
          }
        }
      } catch (cause) { if (!canceled && scopeEpoch.current === epoch) setError(cause instanceof Error ? cause.message : "读取赛狐数据失败。"); }
      finally { inFlight = false; if (!canceled && scopeEpoch.current === epoch) setLoading(false); }
    }
    const delay = window.setTimeout(() => void load(), 300);
    const timer = view.domain === "runs" ? window.setInterval(() => void load(), 5_000) : undefined;
    return () => { canceled = true; controller.abort(); window.clearTimeout(delay); if (timer) window.clearInterval(timer); };
  }, [ready, view, headers, withScope, refreshVersion]);

  const exportHref = useMemo(() => {
    if (!ready || !["stores", "inventory", "sales", "performance", "ads", "runs", "listings"].includes(view.domain)) return "";
    const params = withScope(sellfoxViewParams(view, true)); params.delete("page"); params.delete("pageSize");
    if (view.domain === "performance") params.set("format", "csv");
    if (view.domain === "sales" || columnSelection[columnSelectionKey]) {
      params.set("columns", "custom");
      const keys = columnSelection[columnSelectionKey] ?? defaultVisibleColumnKeys(view.domain, view.dimension);
      for (const key of [...keys, ...(view.domain === "sales" && view.salesView === "matrix" ? dates.map(date => `day:${date}`) : [])]) params.append("column", key);
    }
    return `${endpoint(view.domain)}/export?${params}`;
  }, [ready, view, withScope, columnSelection, columnSelectionKey, dates]);
  const xlsxHref = view.domain === "performance" ? exportHref.replace("format=csv", "format=xlsx") : "";

  async function sync(resource = syncResource) {
    if (!canSync || working) return;
    const disabledReason = sellfoxSyncDisabledReason(resource); if (disabledReason) { setError(disabledReason); return; }
    const epoch = scopeEpoch.current; setWorking(true); setNotice(""); setError("");
    try {
      const dateInput = ["sales", "performance", "ads_report"].includes(resource) && (view.from || view.to) ? { startDate: view.from || view.to, endDate: view.to || view.from }
        : resource === "hourly" ? { reportDate: view.from || view.to || sellfoxDateAt(new Date(), -1) } : {};
      const response = await fetch("/api/sellfox/sync", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ resource, shopExternalIds: view.shops, ...dateInput }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "同步任务创建失败。");
      if (scopeEpoch.current !== epoch) return;
      setNotice(`已加入${resourceLabels[resource]}同步队列，运行 ID：${data.runId ?? "-"}`);
      navigate({ domain: "runs", from: "", to: "", search: "", allDates: false }); setRefreshVersion((value) => value + 1);
    } catch (cause) { if (scopeEpoch.current === epoch) setError(cause instanceof Error ? cause.message : "同步任务创建失败。"); }
    finally { if (scopeEpoch.current === epoch) setWorking(false); }
  }
  async function toggleSchedule(schedule: Schedule) {
    if (!canSync || scheduleWorking) return;
    const epoch = scopeEpoch.current; setScheduleWorking(true);
    try {
      const response = await fetch("/api/sellfox/schedules", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ resource: schedule.resource, enabled: !schedule.enabled, ...(schedule.resource === "sales" && !schedule.enabled && backfillStart ? { backfillStart } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "定时计划更新失败。");
      if (scopeEpoch.current === epoch) { setBackfillStart(""); setRefreshVersion((value) => value + 1); }
    } catch (cause) { if (scopeEpoch.current === epoch) setError(cause instanceof Error ? cause.message : "定时计划更新失败。"); }
    finally { if (scopeEpoch.current === epoch) setScheduleWorking(false); }
  }
  const latestRuns = overview?.latestRuns ?? []; const domainLabel = sellfoxDomains.find((item) => item.id === view.domain)?.label;
  const rawUrl = selectedRow ? `${endpoint(view.domain)}/${encodeURIComponent(String(selectedRow.id))}?${withScope(new URLSearchParams())}` : "";
  return <div className="space-y-2">
    <SellfoxConnectionBar overview={overview} workspaceId={scope.workspaceId} syncResource={syncResource} setSyncResource={setSyncResource} canSync={canSync} canExport={canExport} working={working} onSync={() => void sync()} onRefresh={() => setRefreshVersion((value) => value + 1)} exportHref={exportHref} xlsxHref={xlsxHref} />
    {overview && !overview.configured ? <div className="flex items-center gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertCircle className="h-4 w-4 shrink-0" /><span>请管理员在服务端配置赛狐凭据。此页面不会收集或显示密钥。</span><a className="font-semibold underline" href="/settings">设置与运维</a></div> : null}
    {overview?.configured && overview.stores.length === 0 ? <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-white px-4 py-3"><p className="text-sm">当前工作区尚无赛狐店铺，请先同步店铺。</p><Button size="sm" disabled={!canSync || working} onClick={() => void sync("stores")}><Store className="h-4 w-4" />同步店铺</Button></div> : null}
    {overview?.configured && overview.stores.length > 0 && overview.counts.inventory === 0 ? <div className="border border-border bg-white px-4 py-3 text-sm"><p>还没有库存快照</p><p className="mt-1 text-xs text-muted">{sellfoxSyncDisabledReason("inventory") || "首次同步会记录当前库存，后续保留每次抓取时点。"}</p><Button size="sm" disabled={!canSync || working || Boolean(sellfoxSyncDisabledReason("inventory"))} onClick={() => void sync("inventory")}><RefreshCw className="h-4 w-4" />同步库存</Button></div> : null}
    {notice ? <div role="status" className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div> : null}
    {error || overviewError ? <div role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error || overviewError}</div> : null}
    <SellfoxDomainTabs domain={view.domain} active={latestRuns.some((run) => ["running", "queued"].includes(run.status))} onChange={(domain) => { navigate({ domain }); setSyncResource(resourceForDomain(domain)); }} />
    <div className={`grid gap-3 ${selectedRow || view.domain === "runs" ? "lg:grid-cols-[minmax(0,1fr)_260px]" : ""}`}><main className="min-w-0 space-y-2">
      {view.domain === "overview" ? <>
        <p className="text-xs text-muted">以下为当前工作区全部历史统计；按店铺与日期浏览请切换数据域。覆盖表示曾有记录，不代表今日完整同步。</p>
        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{["stores", "inventory", "sales", "performance", "hourly"].map((key) => <div key={key} className="border border-border bg-white px-4 py-3"><p className="text-xs text-muted">{resourceLabels[key]}</p><p className="mt-1 text-xl font-semibold tabular-nums">{overview?.counts[key] ?? "-"}</p></div>)}</section>
        <section className="grid gap-2 sm:grid-cols-2"><div className="border border-border bg-white px-4 py-3 text-sm">库存历史覆盖 {overview?.coverage?.inventoryStores ?? 0}/{overview?.counts.stores ?? 0} 店 · 缺 {overview?.coverage?.inventoryMissingStores ?? 0} 店</div><div className="border border-border bg-white px-4 py-3 text-sm">销量历史覆盖 {overview?.coverage?.salesStores ?? 0}/{overview?.counts.stores ?? 0} 店 · 缺 {overview?.coverage?.salesMissingStores ?? 0} 店</div></section>
        <section className="border border-border bg-white"><h2 className="border-b border-border px-4 py-3 text-sm font-semibold">定时同步</h2><div className="divide-y divide-border">{schedules.map((schedule) => <label key={schedule.resource} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span>{resourceLabels[schedule.resource]}<span className="ml-2 text-xs text-muted">{["sales", "performance", "listings", "ads_report"].includes(schedule.resource) ? "每日 06:30（北京时间）" : `每 ${Math.round(schedule.intervalMinutes / 60)} 小时`}{sellfoxSyncDisabledReason(schedule.resource) ? " · 未接入" : ""}{schedule.nextRunAt ? ` · 下次 ${new Date(schedule.nextRunAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : ""}</span></span><input aria-label={`${resourceLabels[schedule.resource]}定时同步`} type="checkbox" checked={schedule.enabled} disabled={!canSync || !overview?.configured || scheduleWorking || (!schedule.enabled && Boolean(sellfoxSyncDisabledReason(schedule.resource)))} onChange={() => void toggleSchedule(schedule)} className="h-4 w-4 accent-brand" /></label>)}</div></section>
        <label className="flex flex-wrap items-center gap-2 border border-border bg-white p-3 text-xs text-muted">销量历史补数起始日<input type="date" aria-label="销量补数起始日" value={backfillStart || schedules.find((item) => item.resource === "sales")?.backfillStart || ""} onChange={(event) => setBackfillStart(event.target.value)} className="h-8 border border-border px-2" /><span>下次启用销量计划时保存；修改起始日将重置补数游标。每天 T-1 + 默认7天历史，失败保留断点。{schedules.find((item) => item.resource === "sales")?.backfillNextDate ? `当前游标：${schedules.find((item) => item.resource === "sales")?.backfillNextDate}` : ""}</span></label>
        <SellfoxRecentRuns runs={latestRuns} onAll={() => navigate({ domain: "runs" })} />
      </> : <>
        <SellfoxBrowseFilters productTags={productTags} onRefresh={() => setRefreshVersion(value => value + 1)} exportHref={canExport ? exportHref : undefined} onSync={() => void sync("listings")} syncDisabled={!canSync || working || !overview?.configured || Boolean(sellfoxSyncDisabledReason("listings"))} view={view} stores={overview?.stores ?? []} onChange={navigate} selectedColumns={columnSelection[columnSelectionKey]} onColumns={keys => setColumnSelection(current => ({ ...current, [columnSelectionKey]: keys }))} />
        <div className={view.domain === "ads" ? "grid min-w-0 gap-2 sm:grid-cols-[140px_minmax(0,1fr)]" : "min-w-0"}>{view.domain === "ads" ? <aside aria-label="广告组合列表" className="border border-border bg-white p-3 text-xs"><h3 className="font-semibold">广告组合</h3><p className="mt-3 text-muted">暂无本地数据 · 待接</p><p className="mt-2 text-muted">赛狐有、API/本地无</p></aside> : null}<SellfoxResourceTable metric={view.metric} matrix={view.salesView === "matrix"} dates={dates} totals={totals} selectedColumns={columnSelection[columnSelectionKey]} dimension={view.dimension} domain={view.domain} rows={rows} pagination={pagination} loading={loading} page={view.page} emptyMessage={browseEmptyMessage(view.domain, overview)} onEmptySync={() => void sync(view.domain)} syncDisabled={!canSync || working || !overview?.configured || Boolean(sellfoxSyncDisabledReason(view.domain))} onPageSize={pageSize => navigate({ pageSize, page: 1 })} onPage={(page) => navigate({ page })} onSelect={setSelectedRow} /></div>
        <details className="border border-border bg-white px-3 py-2 text-[11px] text-muted"><summary className="cursor-pointer">读取口径与数据来源 · 本地快照只读</summary><div className="mt-2 space-y-2">
        <p className="text-xs text-muted">{domainLabel}{view.domain === "inventory" ? "默认读取最近完整快照；选择日期或全部历史可回看历史采集。" : ""} · 抓取与同步时间按本机时区显示。导出上限 10,000 条，超限请缩小范围。</p>
        {view.domain === "sales" ? <p className="text-xs text-muted">MSKU 日表按当前维度汇总；父ASIN/标题/价格来自最新 Listing，库存来自最新完整库存快照。未匹配父体时保留 MSKU。— 表示缺失，日矩阵最多90天；小计仅统计已知日，缺日不补零。趋势为窗口末7日，完整才算均值。</p> : null}
        {view.domain === "performance" ? <p className="text-xs text-muted">区间按店铺、维度、币种汇总；毛利率按汇总金额重算，退款率跨多条记录时留空。本地未提升的费用列不从 payload 猜取。</p> : null}
</div></details>
        {canExport && exportHref && view.domain !== "runs" && view.domain !== "stores" ? <a className="text-xs text-brand" href={`${exportHref}&agent=1`}>给 Agent 的导出 CSV（业务窄列）</a> : null}
      </>}
    </main><aside className="space-y-3">{selectedRow || view.domain === "runs" ? <SellfoxSyncRunsPanel overview={overview} /> : null}{selectedRow ? <SellfoxRecordDetail key={`${scope.workspaceId}-${view.domain}-${selectedRow.id}`} row={selectedRow} rawUrl={rawUrl} headers={headers} onClose={() => setSelectedRow(null)} /> : null}</aside></div>
  </div>;
}
