"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, RefreshCw, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { sellfoxDateAt, sellfoxSyncDisabledReason } from "@/lib/sellfox/sync-contract";
import { defaultSellfoxView, readSellfoxView, sellfoxDomains, sellfoxViewParams, type SellfoxView } from "@/lib/sellfox/workbench-view";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { SellfoxConnectionBar, SellfoxShopFilter } from "./connection-bar";
import { SellfoxDomainTabs } from "./domain-tabs";
import { SellfoxResourceTable } from "./resource-table";
import { SellfoxRecentRuns, SellfoxSyncRunsPanel } from "./sync-runs-panel";
import { SellfoxRecordDetail } from "./record-detail";
import { resourceLabels, type Overview, type Pagination, type Row, type Schedule } from "./workbench-types";

function readScope() {
  try { return normalizeWorkspaceScope(JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}")); }
  catch { return normalizeWorkspaceScope(); }
}
function endpoint(domain: SellfoxView["domain"]) { return `/api/sellfox/${domain === "ads" ? "ads_report" : domain}`; }

export function SellfoxWorkbench() {
  const shellUser = useAppShellUser();
  const canSync = roleCanPerformAction(shellUser?.userRole, "sellfox", "create", shellUser?.rolePermissions);
  const canExport = roleCanPerformAction(shellUser?.userRole, "sellfox", "export", shellUser?.rolePermissions);
  const [view, setView] = useState(defaultSellfoxView); const [scope, setScope] = useState(normalizeWorkspaceScope());
  const [ready, setReady] = useState(false); const scopeEpoch = useRef(0);
  const [overview, setOverview] = useState<Overview | null>(null); const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [rows, setRows] = useState<Row[]>([]); const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, total: 0 });
  const [selectedRow, setSelectedRow] = useState<Row | null>(null); const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false); const [scheduleWorking, setScheduleWorking] = useState(false);
  const [syncResource, setSyncResource] = useState("stores"); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
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
    setScope(readScope()); setView(readSellfoxView(new URLSearchParams(window.location.search))); setReady(true);
    const pop = () => { setView(readSellfoxView(new URLSearchParams(window.location.search))); setSelectedRow(null); setRows([]); setPagination({ page: 1, pageSize: 50, total: 0 }); setError(""); };
    const changed = () => {
      scopeEpoch.current += 1; setScope(readScope()); setBackfillStart(""); setOverview(null); setSchedules([]); setRows([]); setSelectedRow(null);
      setPagination({ page: 1, pageSize: 50, total: 0 }); setError(""); setOverviewError(""); setNotice(""); setWorking(false); setScheduleWorking(false); setLoading(true);
      const next = { ...readSellfoxView(new URLSearchParams(window.location.search)), shops: [], site: "", page: 1 };
      setView(next);
      const params = sellfoxViewParams(next); params.set("workspaceId", readScope().workspaceId);
      window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    };
    window.addEventListener("popstate", pop); window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => { scopeEpoch.current += 1; window.removeEventListener("popstate", pop); window.removeEventListener(workspaceScopeChangedEventName, changed); };
  }, []);

  function navigate(patch: Partial<SellfoxView>, replace = false) {
    const next = { ...view, page: 1, ...patch }; setView(next); setSelectedRow(null); setRows([]); setPagination({ page: next.page, pageSize: 50, total: 0 }); setLoading(true); setError("");
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
        if (!canceled && scopeEpoch.current === epoch) { setRows(data.rows ?? []); setPagination(data.pagination ?? { page: view.page, pageSize: 50, total: 0 }); }
      } catch (cause) { if (!canceled && scopeEpoch.current === epoch) setError(cause instanceof Error ? cause.message : "读取赛狐数据失败。"); }
      finally { inFlight = false; if (!canceled && scopeEpoch.current === epoch) setLoading(false); }
    }
    const delay = window.setTimeout(() => void load(), 120);
    const timer = view.domain === "runs" ? window.setInterval(() => void load(), 5_000) : undefined;
    return () => { canceled = true; controller.abort(); window.clearTimeout(delay); if (timer) window.clearInterval(timer); };
  }, [ready, view, headers, withScope, refreshVersion]);

  const exportHref = useMemo(() => {
    if (!ready || !["stores", "inventory", "sales", "performance", "ads", "runs", "listings"].includes(view.domain)) return "";
    const params = withScope(sellfoxViewParams(view, true)); params.delete("page"); params.delete("pageSize");
    if (view.domain === "performance") params.set("format", "csv");
    return `${endpoint(view.domain)}/export?${params}`;
  }, [ready, view, withScope]);
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
  const sites = [...new Set((overview?.stores ?? []).map((store) => store.marketplace).filter(Boolean))];
  const appliedDate = withScope(sellfoxViewParams(view, true)).get("reportDate");
  const rawUrl = selectedRow ? `${endpoint(view.domain)}/${encodeURIComponent(String(selectedRow.id))}?${withScope(new URLSearchParams())}` : "";
  return <div className="space-y-4">
    <SellfoxConnectionBar overview={overview} workspaceId={scope.workspaceId} syncResource={syncResource} setSyncResource={setSyncResource} canSync={canSync} canExport={canExport} working={working} onSync={() => void sync()} onRefresh={() => setRefreshVersion((value) => value + 1)} exportHref={exportHref} xlsxHref={xlsxHref} />
    {overview && !overview.configured ? <div className="flex items-center gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertCircle className="h-4 w-4 shrink-0" /><span>请管理员在服务端配置赛狐凭据。此页面不会收集或显示密钥。</span><a className="font-semibold underline" href="/settings">设置与运维</a></div> : null}
    {overview?.configured && overview.stores.length === 0 ? <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-white px-4 py-3"><p className="text-sm">当前工作区尚无赛狐店铺，请先同步店铺。</p><Button size="sm" disabled={!canSync || working} onClick={() => void sync("stores")}><Store className="h-4 w-4" />同步店铺</Button></div> : null}
    {overview?.configured && overview.stores.length > 0 && overview.counts.inventory === 0 ? <div className="border border-border bg-white px-4 py-3 text-sm"><p>还没有库存快照</p><p className="mt-1 text-xs text-muted">{sellfoxSyncDisabledReason("inventory") || "首次同步会记录当前库存，后续保留每次抓取时点。"}</p><Button size="sm" disabled={!canSync || working || Boolean(sellfoxSyncDisabledReason("inventory"))} onClick={() => void sync("inventory")}><RefreshCw className="h-4 w-4" />同步库存</Button></div> : null}
    {notice ? <div role="status" className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div> : null}
    {error || overviewError ? <div role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error || overviewError}</div> : null}
    <div className="grid items-end gap-3 border border-border bg-white p-3 sm:grid-cols-2"><SellfoxShopFilter stores={overview?.stores ?? []} value={view.shops} disabled={view.domain === "runs"} onChange={(shops) => navigate({ shops })} /><label className="text-xs text-muted">站点<select aria-label="站点筛选" value={view.site} disabled={view.domain === "runs"} onChange={(event) => navigate({ site: event.target.value })} className="mt-1 h-9 w-full border border-border bg-white px-2 text-sm text-foreground"><option value="">全部站点</option>{view.site && !sites.includes(view.site) ? <option value={view.site}>{view.site}</option> : null}{sites.map((site) => <option key={site} value={site}>{site}</option>)}</select></label></div>
    <SellfoxDomainTabs domain={view.domain} active={latestRuns.some((run) => ["running", "queued"].includes(run.status))} onChange={(domain) => navigate({ domain })} />
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]"><main className="min-w-0 space-y-3">
      {view.domain === "overview" ? <>
        <p className="text-xs text-muted">以下为当前工作区全部历史统计；按店铺与日期浏览请切换数据域。覆盖表示曾有记录，不代表今日完整同步。</p>
        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{["stores", "inventory", "sales", "performance", "hourly"].map((key) => <div key={key} className="border border-border bg-white px-4 py-3"><p className="text-xs text-muted">{resourceLabels[key]}</p><p className="mt-1 text-xl font-semibold tabular-nums">{overview?.counts[key] ?? "-"}</p></div>)}</section>
        <section className="grid gap-2 sm:grid-cols-2"><div className="border border-border bg-white px-4 py-3 text-sm">库存历史覆盖 {overview?.coverage?.inventoryStores ?? 0}/{overview?.counts.stores ?? 0} 店 · 缺 {overview?.coverage?.inventoryMissingStores ?? 0} 店</div><div className="border border-border bg-white px-4 py-3 text-sm">销量历史覆盖 {overview?.coverage?.salesStores ?? 0}/{overview?.counts.stores ?? 0} 店 · 缺 {overview?.coverage?.salesMissingStores ?? 0} 店</div></section>
        <section className="border border-border bg-white"><h2 className="border-b border-border px-4 py-3 text-sm font-semibold">定时同步</h2><div className="divide-y divide-border">{schedules.map((schedule) => <label key={schedule.resource} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span>{resourceLabels[schedule.resource]}<span className="ml-2 text-xs text-muted">{["sales", "performance", "listings", "ads_report"].includes(schedule.resource) ? "每日 06:30（北京时间）" : `每 ${Math.round(schedule.intervalMinutes / 60)} 小时`}{sellfoxSyncDisabledReason(schedule.resource) ? " · 未接入" : ""}{schedule.nextRunAt ? ` · 下次 ${new Date(schedule.nextRunAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : ""}</span></span><input aria-label={`${resourceLabels[schedule.resource]}定时同步`} type="checkbox" checked={schedule.enabled} disabled={!canSync || !overview?.configured || scheduleWorking || (!schedule.enabled && Boolean(sellfoxSyncDisabledReason(schedule.resource)))} onChange={() => void toggleSchedule(schedule)} className="h-4 w-4 accent-brand" /></label>)}</div></section>
        <label className="flex flex-wrap items-center gap-2 border border-border bg-white p-3 text-xs text-muted">销量历史补数起始日<input type="date" aria-label="销量补数起始日" value={backfillStart || schedules.find((item) => item.resource === "sales")?.backfillStart || ""} onChange={(event) => setBackfillStart(event.target.value)} className="h-8 border border-border px-2" /><span>下次启用销量计划时保存；修改起始日将重置补数游标。每天 T-1 + 默认7天历史，失败保留断点。{schedules.find((item) => item.resource === "sales")?.backfillNextDate ? `当前游标：${schedules.find((item) => item.resource === "sales")?.backfillNextDate}` : ""}</span></label>
        <SellfoxRecentRuns runs={latestRuns} onAll={() => navigate({ domain: "runs" })} />
      </> : <>
        {view.domain === "ads" ? <div className="border border-border bg-white p-3 text-xs text-muted"><p>广告产品日报：默认 SP，读取本地窄表；SB/SD 可通过同步 API 按需请求，未知报告结构拒绝落库。</p><p className="mt-1">下载任务 → 进度 → XLSX → 本地日表。报告无币种列，币种为空；小时样本保留在 /api/sellfox/hourly 高级调试入口。</p></div> : null}
        <div className="grid gap-2 border border-border bg-white p-3 sm:grid-cols-3">
          <input type="date" value={view.from} disabled={view.domain === "stores" || view.domain === "listings"} onChange={(event) => navigate({ from: event.target.value, allDates: false })} aria-label="开始日期" className="h-9 border border-border px-2 text-sm" />
          <input type="date" value={view.to} disabled={view.domain === "stores" || view.domain === "listings"} onChange={(event) => navigate({ to: event.target.value, allDates: false })} aria-label="结束日期" className="h-9 border border-border px-2 text-sm" />
          <input value={view.search} aria-label="搜索记录" onChange={(event) => navigate({ search: event.target.value }, true)} placeholder={view.domain === "runs" ? "资源、状态或运行 ID" : view.domain === "ads" ? "活动名称或 ID" : "搜索 ASIN、MSKU、SKU 或店铺"} className="h-9 border border-border px-3 text-sm" />
          {view.domain !== "stores" && view.domain !== "listings" ? <div className="flex flex-wrap items-center gap-2 sm:col-span-3">{[{ label: "今天", offset: 0 }, { label: "昨天", offset: -1 }, { label: "近 7 天", offset: -6 }].map(({ label, offset }) => <button key={label} className="border border-border px-2 py-1 text-xs hover:bg-surface-muted" onClick={() => navigate({ from: sellfoxDateAt(new Date(), offset), to: sellfoxDateAt(new Date(), offset === -6 ? 0 : offset), allDates: false })}>{label}</button>)}<button className="border border-border px-2 py-1 text-xs hover:bg-surface-muted" onClick={() => navigate({ from: "", to: "", allDates: true })}>全部历史</button><span className="text-xs text-muted">{view.domain === "runs" ? "按任务开始日期（北京时间），店铺/站点筛选不适用。" : `业务日（北京时间）：${view.from || view.to ? `${view.from || "不限"} 至 ${view.to || "不限"}` : view.allDates ? "全部历史" : appliedDate}`}</span></div> : null}
        </div>
        {canExport && exportHref && view.domain !== "runs" && view.domain !== "stores" ? <a className="text-xs text-brand" href={`${exportHref}&agent=1`}>给 Agent 的导出 CSV（业务窄列）</a> : null}
        <p className="text-xs text-muted">{domainLabel}{view.domain === "inventory" ? "默认读取最近完整快照；选择日期或全部历史可回看历史采集。" : ""} · 抓取与同步时间按本机时区显示。导出上限 10,000 条，超限请缩小范围。</p>
        {view.domain === "listings" ? <label className="flex items-center gap-2 text-xs text-muted">最新完整快照 · 状态<select aria-label="Listing 状态" value={view.status ?? ""} onChange={(event) => navigate({ status: event.target.value })} className="h-9 border border-border bg-white px-2"><option value="">全部</option><option value="active">在售</option><option value="inActive">不可售</option><option value="delete">删除</option><option value="incomplete">未完成</option></select></label> : null}
        <SellfoxResourceTable domain={view.domain} rows={rows} pagination={pagination} loading={loading} page={view.page} onPage={(page) => navigate({ page })} onSelect={setSelectedRow} />
      </>}
    </main><aside className="space-y-3"><SellfoxSyncRunsPanel overview={overview} />{selectedRow ? <SellfoxRecordDetail key={`${scope.workspaceId}-${view.domain}-${selectedRow.id}`} row={selectedRow} rawUrl={rawUrl} headers={headers} onClose={() => setSelectedRow(null)} /> : null}</aside></div>
  </div>;
}
