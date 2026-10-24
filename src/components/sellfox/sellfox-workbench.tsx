"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, Download, RefreshCw, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type Domain = "overview" | "stores" | "inventory" | "sales" | "performance" | "listings" | "ads" | "runs";
type Row = Record<string, unknown>;
type Pagination = { page: number; pageSize: number; total: number };
type StoreRow = { id: string; externalId: string; name: string; marketplace: string; country: string; status: string; lastSyncedAt: string };
type Run = { id: string; resource: string; status: string; summary?: Row | null; error?: string | null; startedAt: string; finishedAt?: string | null };
type Overview = { configured: boolean; stores: StoreRow[]; counts: Record<string, number>; coverage?: { inventoryStores: number; inventoryMissingStores: number; salesStores: number; salesMissingStores: number }; latestRuns: Run[]; latestSuccessByResource?: Record<string, Run>; workerOnline?: boolean };
type Schedule = { resource: string; enabled: boolean; intervalMinutes: number };
type Scope = { workspaceId: string; accountId: string; marketplace: string };

const domains: Array<{ id: Domain; label: string }> = [
  { id: "overview", label: "概览" }, { id: "stores", label: "店铺" }, { id: "inventory", label: "库存" },
  { id: "sales", label: "销量" }, { id: "performance", label: "产品表现" }, { id: "listings", label: "在线 Listing" },
  { id: "ads", label: "广告" }, { id: "runs", label: "同步日志" },
];
const workspaceStorageKey = "amazon_bulk_ad_workspace_scope";
const captions: Record<string, string> = {
  reportDate: "业务日期", capturedAt: "抓取时间", externalId: "Shop ID", name: "店铺", marketplace: "站点", country: "国家", status: "状态",
  asin: "ASIN", msku: "MSKU", sku: "SKU", fnsku: "FNSKU", quantity: "库存", revenue: "销售额", currency: "币种", saleQuantity: "销量",
  saleRevenue: "销售额", grossProfit: "毛利润", adCost: "广告费", title: "标题", resource: "资源", startedAt: "开始时间", finishedAt: "结束时间",
  error: "错误", syncedAt: "同步时间", id: "运行 ID", summary: "摘要", lastSyncedAt: "最近同步",
  hour: "小时", adType: "广告类型", entityName: "活动", impressions: "曝光", clicks: "点击", cost: "花费", sales: "销售额", orders: "订单",
};

function readScope(): Scope {
  try { return JSON.parse(localStorage.getItem(workspaceStorageKey) ?? "{}") as Scope; }
  catch { return { workspaceId: "default", accountId: "", marketplace: "" }; }
}
function scopeHeaders(): HeadersInit {
  const scope = readScope();
  return { "x-workspace-id": scope.workspaceId || "default", ...(scope.accountId ? { "x-account-id": scope.accountId } : {}), ...(scope.marketplace ? { "x-marketplace": scope.marketplace } : {}) };
}
function queryScope(params: URLSearchParams) {
  const scope = readScope(); params.set("workspaceId", scope.workspaceId || "default");
  if (scope.accountId) params.set("accountId", scope.accountId);
  if (scope.marketplace) params.set("marketplace", scope.marketplace);
  return params;
}
function dateTime(value: unknown) { return typeof value === "string" && value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-"; }
function shanghaiDate(offsetDays: number) { return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }); }
function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (value instanceof Date) return dateTime(value.toISOString());
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
export function SellfoxWorkbench() {
  const shellUser = useAppShellUser();
  const canSync = roleCanPerformAction(shellUser?.userRole, "sellfox", "create", shellUser?.rolePermissions);
  const [domain, setDomain] = useState<Domain>("overview");
  const [scopeReady, setScopeReady] = useState(false);
  const [scopeRevision, setScopeRevision] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, total: 0 });
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [syncResource, setSyncResource] = useState("inventory");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    const [overviewResponse, scheduleResponse] = await Promise.all([
      fetch("/api/sellfox/overview", { headers: scopeHeaders(), cache: "no-store", signal }),
      fetch("/api/sellfox/schedules", { headers: scopeHeaders(), cache: "no-store", signal }),
    ]);
    const data = await overviewResponse.json() as Overview & { error?: string };
    if (!overviewResponse.ok) throw new Error(data.error || "读取赛狐概览失败。");
    const scheduleData = await scheduleResponse.json() as { schedules?: Schedule[] };
    setOverview(data); setSchedules(scheduleData.schedules ?? []);
    setSelectedShops((current) => current.length ? current.filter((shopId) => data.stores.some((store) => store.externalId === shopId)) : []);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (domains.some((item) => item.id === params.get("domain"))) setDomain(params.get("domain") as Domain);
    setFrom(params.get("from") ?? ""); setTo(params.get("to") ?? ""); setSearch(params.get("search") ?? "");
    setSelectedShops(params.getAll("shopExternalId"));
    setPage(Math.max(1, Number(params.get("page")) || 1));
    setScopeReady(true);
  }, []);

  useEffect(() => {
    const changed = () => { setSelectedShops([]); setPage(1); setSelectedRow(null); setScopeRevision((value) => value + 1); };
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => window.removeEventListener(workspaceScopeChangedEventName, changed);
  }, []);

  useEffect(() => {
    if (!scopeReady) return;
    const params = queryScope(new URLSearchParams());
    if (domain !== "overview") params.set("domain", domain);
    if (from) params.set("from", from); if (to) params.set("to", to); if (search) params.set("search", search);
    for (const shop of selectedShops) params.append("shopExternalId", shop);
    if (page > 1) params.set("page", String(page));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [domain, from, to, search, selectedShops, page, scopeReady]);

  useEffect(() => {
    let canceled = false;
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = window.setTimeout(async () => {
      try {
        await loadOverview(controller.signal);
        if (domain === "overview" || domain === "listings") { if (!canceled) setRows([]); return; }
        const params = queryScope(new URLSearchParams({ page: String(page), pageSize: "50" }));
        if (from) params.set("from", from); if (to) params.set("to", to);
        if (!from && !to && domain !== "stores" && domain !== "runs") params.set("reportDate", shanghaiDate(domain === "inventory" ? 0 : -1));
        if (search.trim()) params.set("search", search.trim());
        for (const shop of selectedShops) params.append("shopExternalId", shop);
        const endpoint = domain === "performance" ? "/api/sellfox/performance" : `/api/sellfox/${domain === "ads" ? "hourly" : domain}`;
        const response = await fetch(`${endpoint}?${params}`, { headers: scopeHeaders(), cache: "no-store", signal: controller.signal });
        const data = await response.json() as { rows?: Row[]; pagination?: Pagination; error?: string };
        if (!response.ok) throw new Error(data.error || "读取赛狐数据失败。");
        if (!canceled) { setRows(data.rows ?? []); setPagination(data.pagination ?? { page, pageSize: 50, total: 0 }); }
      } catch (cause) { if (!canceled) setError(cause instanceof Error ? cause.message : "读取赛狐数据失败。"); }
      finally { if (!canceled) setLoading(false); }
    }, 120);
    return () => { canceled = true; controller.abort(); window.clearTimeout(timer); };
  }, [domain, from, to, search, selectedShops, page, loadOverview, scopeRevision, scopeReady]);

  useEffect(() => {
    if (domain !== "runs") return;
    const timer = window.setInterval(async () => {
      try {
        const params = queryScope(new URLSearchParams({ page: String(page), pageSize: "50" }));
        const response = await fetch(`/api/sellfox/runs?${params}`, { headers: scopeHeaders(), cache: "no-store" });
        const data = await response.json() as { rows?: Row[]; pagination?: Pagination };
        if (response.ok) { setRows(data.rows ?? []); setPagination(data.pagination ?? { page, pageSize: 50, total: 0 }); await loadOverview(); }
      } catch { /* Keep the last visible run state until the next poll. */ }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [domain, page, loadOverview]);

  const exportHref = useMemo(() => {
    if (!["stores", "inventory", "sales", "performance", "ads", "runs"].includes(domain)) return "";
    const params = queryScope(new URLSearchParams()); if (from) params.set("from", from); if (to) params.set("to", to);
    if (search.trim()) params.set("search", search.trim()); for (const shop of selectedShops) params.append("shopExternalId", shop);
    if (!from && !to && domain !== "stores" && domain !== "runs") params.set("reportDate", shanghaiDate(domain === "inventory" ? 0 : -1));
    if (domain === "performance") params.set("format", "csv");
    return `/api/sellfox/${domain === "ads" ? "hourly" : domain}/export?${params.toString()}`;
  }, [domain, from, to, search, selectedShops]);

  async function sync(resource = syncResource) {
    setWorking(true); setNotice(""); setError("");
    try {
      const dateInput = resource === "inventory" ? { reportDate: shanghaiDate(0) }
        : ["sales", "performance"].includes(resource) && from && to ? { startDate: from, endDate: to }
          : ["sales", "performance", "hourly"].includes(resource) ? { reportDate: from || to || shanghaiDate(-1) } : {};
      const response = await fetch("/api/sellfox/sync", { method: "POST", headers: { ...scopeHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ resource, shopExternalIds: selectedShops, ...dateInput }) });
      const payload = await response.json() as { runId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "同步任务创建失败。");
      setNotice(`已加入 ${resource} 同步队列，运行 ID：${payload.runId ?? "-"}`);
      setDomain("runs"); await loadOverview();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "同步任务创建失败。"); }
    finally { setWorking(false); }
  }

  async function toggleSchedule(schedule: Schedule) {
    if (!canSync) return;
    try {
      const response = await fetch("/api/sellfox/schedules", { method: "POST", headers: { ...scopeHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ resource: schedule.resource, enabled: !schedule.enabled }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "定时计划更新失败。");
      await loadOverview();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "定时计划更新失败。"); }
  }

  const latestRuns = overview?.latestRuns ?? [];
  const currentDomain = domains.find((item) => item.id === domain)?.label ?? "概览";
  const unavailable = domain === "listings";
  const columns = domain === "runs" ? ["resource", "status", "startedAt", "finishedAt", "error"]
    : domain === "stores" ? ["name", "externalId", "marketplace", "country", "status", "lastSyncedAt"]
      : domain === "inventory" ? ["reportDate", "capturedAt", "name", "marketplace", "asin", "msku", "sku", "fnsku", "quantity"]
        : domain === "sales" ? ["reportDate", "name", "marketplace", "asin", "msku", "sku", "quantity", "revenue", "currency"]
          : domain === "ads" ? ["reportDate", "hour", "name", "marketplace", "adType", "entityName", "impressions", "clicks", "cost", "sales", "orders"]
            : ["reportDate", "name", "marketplace", "asin", "msku", "sku", "title", "saleQuantity", "saleRevenue", "grossProfit", "adCost"];

  return <div className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand text-white"><Store className="h-5 w-5" /></div>
        <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-base font-bold">赛狐数据工作台</h1><Badge tone={overview?.configured ? "green" : "amber"}>{overview ? overview.configured ? "服务端凭据已配置" : "等待配置凭据" : "读取中"}</Badge><Badge tone="gray">工作区 {readScope().workspaceId || "default"}</Badge>{overview?.configured ? <Badge tone={overview.workerOnline ? "green" : "red"}>Worker {overview.workerOnline ? "在线" : "离线"}</Badge> : null}</div><p className="mt-1 text-xs text-muted">报表快照长期保留，可按业务日期和库存抓取时间查看。</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="立即同步资源" value={syncResource} onChange={(event) => setSyncResource(event.target.value)} className="h-9 border border-border bg-white px-2 text-sm">
          {["stores", "inventory", "sales", "performance", "hourly"].map((resource) => <option key={resource} value={resource}>{({ stores: "店铺", inventory: "FBA 库存", sales: "销量", performance: "产品表现", hourly: "SP 小时样本" } as Record<string, string>)[resource]}</option>)}
        </select>
        <Button size="sm" onClick={() => void sync()} disabled={!canSync || !overview?.configured || working}><RefreshCw className={`h-4 w-4 ${working ? "animate-spin" : ""}`} />立即同步</Button>
        <Button size="sm" variant="secondary" onClick={() => void loadOverview().catch((cause) => setError(cause instanceof Error ? cause.message : "读取概览失败。"))}><RefreshCw className="h-4 w-4" />刷新</Button>
        {exportHref ? <a className="inline-flex h-9 items-center gap-2 border border-border px-3 text-sm font-medium hover:bg-surface-muted" href={exportHref}><Download className="h-4 w-4" />CSV</a> : null}
      </div>
    </header>

    {overview && !overview.configured ? <div className="flex items-center gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertCircle className="h-4 w-4 shrink-0" /><span>请管理员在服务端配置赛狐凭据。此页面不会收集或显示密钥。</span><a className="font-semibold underline" href="/settings">设置与运维</a></div> : null}
    {overview?.configured && overview.stores.length === 0 ? <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-white px-4 py-3"><div><p className="text-sm font-semibold">当前工作区尚无赛狐店铺</p><p className="mt-1 text-xs text-muted">同步店铺后即可按店铺拉取库存、销量和表现。</p></div><Button size="sm" disabled={!canSync || working} onClick={() => void sync("stores")}><Store className="h-4 w-4" />同步店铺</Button></div> : null}
    {overview?.configured && overview.stores.length > 0 && overview.counts.inventory === 0 ? <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-white px-4 py-3"><div><p className="text-sm font-semibold">还没有库存快照</p><p className="mt-1 text-xs text-muted">首次同步会记录当前库存；后续手动或定时同步会保留每次抓取时点。</p></div><Button size="sm" disabled={!canSync || working} onClick={() => void sync("inventory")}><RefreshCw className="h-4 w-4" />同步库存</Button></div> : null}
    {notice ? <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</div> : null}
    {error ? <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

    <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="赛狐数据域">
      {domains.map((item) => <button key={item.id} onClick={() => { setDomain(item.id); setPage(1); setSelectedRow(null); }} className={`shrink-0 border-b-2 px-3 py-2 text-sm ${domain === item.id ? "border-brand font-semibold text-brand" : "border-transparent text-muted hover:text-foreground"}`}>{item.label}{item.id === "runs" && latestRuns.some((run) => run.status === "running" || run.status === "queued") ? <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}</button>)}
    </nav>

    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
      <main className="min-w-0">
        {domain === "overview" ? <div className="space-y-5">
          <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{["stores", "inventory", "sales", "performance", "hourly"].map((key) => <div key={key} className="border border-border bg-white px-4 py-3"><p className="text-xs text-muted">{({ stores: "店铺", inventory: "库存快照", sales: "销量快照", performance: "表现快照", hourly: "小时样本" } as Record<string, string>)[key]}</p><p className="mt-1 text-xl font-semibold tabular-nums">{overview?.counts[key] ?? 0}</p></div>)}</section>
          <section className="grid gap-2 sm:grid-cols-2"><div className="border border-border bg-white px-4 py-3 text-sm">库存覆盖 {overview?.coverage?.inventoryStores ?? 0}/{overview?.counts.stores ?? 0} 店<span className="ml-2 text-muted">缺 {overview?.coverage?.inventoryMissingStores ?? 0} 店</span></div><div className="border border-border bg-white px-4 py-3 text-sm">销量覆盖 {overview?.coverage?.salesStores ?? 0}/{overview?.counts.stores ?? 0} 店<span className="ml-2 text-muted">缺 {overview?.coverage?.salesMissingStores ?? 0} 店</span></div></section>
          <section className="border border-border bg-white"><div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">定时同步</h2></div><div className="divide-y divide-border">{schedules.map((schedule) => <label key={schedule.resource} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span><span className="font-medium">{({ stores: "店铺", inventory: "FBA 库存", sales: "销量", performance: "产品表现" } as Record<string, string>)[schedule.resource]}</span><span className="ml-2 text-xs text-muted">{schedule.resource === "sales" || schedule.resource === "performance" ? "每日 06:30（北京时间）" : `每 ${Math.round(schedule.intervalMinutes / 60)} 小时`}</span></span><input type="checkbox" checked={schedule.enabled} disabled={!canSync || !overview?.configured} onChange={() => void toggleSchedule(schedule)} className="h-4 w-4 accent-brand" /></label>)}</div></section>
          <section className="border border-border bg-white"><div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">最近同步</h2><button className="text-xs font-semibold text-brand" onClick={() => setDomain("runs")}>全部日志</button></div><div className="divide-y divide-border">{latestRuns.slice(0, 6).map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><span className="font-medium">{run.resource}</span><span className="text-xs text-muted">{dateTime(run.startedAt)}</span><Badge tone={run.status === "done" ? "green" : run.status === "failed" ? "red" : "amber"}>{run.status}</Badge>{run.error ? <span className="basis-full text-xs text-red-700">{run.error}</span> : null}</div>)}{latestRuns.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">暂无同步记录。</p> : null}</div></section>
        </div> : unavailable ? <section className="border border-border bg-white px-5 py-10"><h2 className="text-sm font-semibold">{currentDomain}尚未接入</h2><p className="mt-2 text-sm text-muted">未核验赛狐接口契约前不会发起请求或展示模拟数据。Listing Open API 与广告报告接口暂不可用。</p><p className="mt-3 text-xs text-muted">广告小时视图展示现有 SP campaign 浅同步样本，可通过顶部资源菜单手动拉取。</p></section> : <section className="border border-border bg-white">
          <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[minmax(220px,1fr)_minmax(140px,200px)_minmax(140px,200px)]">
            <div className="min-w-0"><select multiple value={selectedShops} onChange={(event) => { setSelectedShops(Array.from(event.currentTarget.selectedOptions, (option) => option.value)); setPage(1); }} aria-label="店铺筛选" className="h-10 w-full min-w-0 border border-border bg-white px-2 text-sm">{(overview?.stores ?? []).map((store) => <option key={store.id} value={store.externalId}>{store.name || store.externalId} · {store.marketplace || ""}</option>)}</select><span className="text-[10px] text-muted">店铺多选；未选表示全部</span></div>
            <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} aria-label="开始日期" className="h-10 border border-border px-2 text-sm" />
            <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} aria-label="结束日期" className="h-10 border border-border px-2 text-sm" />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索 ASIN、MSKU 或 SKU" className="h-10 border border-border px-3 text-sm sm:col-span-2" />
            <span className="flex items-center text-xs text-muted">{currentDomain} · {pagination.total.toLocaleString()} 条</span>
          </div>
          <div className="max-h-[62vh] overflow-auto thin-scrollbar">
            <table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-surface-muted text-muted"><tr>{columns.map((key) => <th key={key} className="whitespace-nowrap px-3 py-2.5 font-semibold">{captions[key] ?? key}</th>)}</tr></thead>
              <tbody>{rows.map((row, index) => {
                const store = row.SellfoxStore as Row | undefined;
                const enriched: Row = { ...row, name: store?.name ?? row.name, marketplace: store?.marketplace ?? row.marketplace };
                return <tr key={String(row.id ?? index)} onClick={() => setSelectedRow(row)} className="cursor-pointer border-t border-border align-top hover:bg-surface-muted/50">{columns.map((key) => <td key={key} className="max-w-[260px] truncate whitespace-nowrap px-3 py-2.5">{display(enriched[key])}</td>)}</tr>;
              })}{rows.length === 0 ? <tr><td className="px-4 py-10 text-center text-muted" colSpan={11}>{loading ? "正在读取…" : "当前筛选暂无数据。"}</td></tr> : null}</tbody></table>
          </div>
          <footer className="flex items-center justify-between border-t border-border px-3 py-2 text-xs"><span>第 {pagination.page} 页 / {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))} 页</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button><Button size="sm" variant="secondary" disabled={page >= Math.ceil(pagination.total / pagination.pageSize) || loading} onClick={() => setPage((value) => value + 1)}>下一页</Button></div></footer>
        </section>}
      </main>
      <aside className="space-y-3">
        <section className="border border-border bg-white"><div className="flex items-center gap-2 border-b border-border px-3 py-2.5"><Clock3 className="h-4 w-4 text-muted" /><h2 className="text-xs font-semibold">资源健康度</h2></div><div className="divide-y divide-border">{["stores", "inventory", "sales", "performance", "hourly"].map((resource) => { const latest = overview?.latestSuccessByResource?.[resource]; const recentFailure = latestRuns.find((run) => run.resource === resource && run.status === "failed"); const failedIsLatest = Boolean(recentFailure && (!latest || new Date(recentFailure.startedAt) > new Date(latest.startedAt))); return <div key={resource} className="px-3 py-2.5"><div className="flex items-center justify-between text-xs"><span>{resource}</span>{failedIsLatest ? <span className="text-red-700">最近失败</span> : latest ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="text-muted">未同步</span>}</div><p className="mt-1 text-[11px] text-muted">最近成功：{latest ? dateTime(latest.finishedAt || latest.startedAt) : "暂无"}</p>{failedIsLatest && recentFailure?.error ? <p className="mt-1 line-clamp-2 text-[10px] text-red-700">{recentFailure.error}</p> : null}</div>; })}</div></section>
        {selectedRow ? <section className="border border-border bg-white"><div className="flex items-center justify-between border-b border-border px-3 py-2.5"><h2 className="text-xs font-semibold">记录摘要</h2><button aria-label="关闭详情" onClick={() => setSelectedRow(null)} className="text-muted hover:text-foreground">×</button></div><dl className="max-h-80 space-y-2 overflow-auto p-3">{Object.entries(selectedRow).filter(([key]) => key !== "SellfoxStore").map(([key, value]) => <div key={key}><dt className="text-[10px] text-muted">{captions[key] ?? key}</dt><dd className="break-words text-xs">{display(value)}</dd></div>)}</dl></section> : null}
      </aside>
    </div>
  </div>;
}
