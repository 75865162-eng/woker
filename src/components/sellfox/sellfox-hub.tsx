"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useVisiblePolling } from "@/lib/hooks/use-visible-polling";
import { AlertCircle, ArrowUpRight, CheckCircle2, Clock3, Loader2, PlayCircle, RefreshCw, Store } from "lucide-react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { sellfoxPlanGroups, type SellfoxPlanItem, type SellfoxPlanStatus } from "@/lib/sellfox/data-plan";
import { sellfoxDateAt, type SellfoxSyncResource } from "@/lib/sellfox/sync-contract";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";

type Dataset = {
  key: string; label: string; resource: SellfoxSyncResource; table: string; href: string | null;
  rows: number; latest: string | null; storesWithData: number;
  lastRun: { id: string; status: string; startedAt: string; finishedAt: string | null; error: string | null } | null;
};
type Run = { id: string; resource: string; status: string; error: string | null; startedAt: string; finishedAt: string | null; progress: number | null; result: unknown };
type Hub = {
  configured: boolean; credentialSource: string; encryptionReady: boolean; workerOnline: boolean;
  stores: { externalId: string; name: string; marketplace: string; lastSyncedAt: string | null }[];
  storeCount: number; datasets: Dataset[]; hourlyRows: number;
  plan: { total: number; live: number; planned: number; blocked: number };
  lastSuccess: Record<string, string>; runs: Run[];
};

const statusMeta: Record<SellfoxPlanStatus, { label: string; className: string }> = {
  live: { label: "已接入", className: "border-success/20 bg-success-soft text-success-ink" },
  planned: { label: "待接入", className: "border-accent/20 bg-warning-soft text-warning-ink" },
  blocked: { label: "需授权", className: "border-border-strong bg-surface-muted text-muted" },
};
const runStatusText: Record<string, string> = { queued: "排队", running: "运行中", done: "完成", failed: "失败" };

function readScope() {
  try { return normalizeWorkspaceScope(JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}")); }
  catch { return normalizeWorkspaceScope(); }
}
function fmt(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function n(value: number | undefined | null) { return value === undefined || value === null ? "—" : value.toLocaleString("zh-CN"); }

const dateSensitive = new Set<string>(["sales", "performance", "orders", "ads_report", "ads_campaign", "ads_ad_group", "ads_placement", "ads_targeting", "ads_search_term"]);

export function SellfoxHub() {
  const shellUser = useAppShellUser();
  const canSync = roleCanPerformAction(shellUser?.userRole, "sellfox", "create", shellUser?.rolePermissions);
  const [scope, setScope] = useState(normalizeWorkspaceScope());
  const [data, setData] = useState<Hub | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [syncFeedback, setSyncFeedback] = useState<{ resource: SellfoxSyncResource; message: string; failed: boolean } | null>(null);
  const [batch, setBatch] = useState<{ index: number; total: number; current: string } | null>(null);
  const [from, setFrom] = useState(sellfoxDateAt(new Date(), -6));
  const [to, setTo] = useState(sellfoxDateAt(new Date(), 0));
  const [activeGroup, setActiveGroup] = useState<string>("all");
  const headers = useMemo(() => ({ "x-workspace-id": scope.workspaceId }), [scope.workspaceId]);

  useEffect(() => { setScope(readScope()); }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/sellfox/hub", { headers, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "读取概览失败。");
      setData(payload as Hub); setLoadError("");
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : "读取概览失败。"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { void load(); }, [load]);
  const running = Boolean(data?.runs.some((run) => ["queued", "running"].includes(run.status)) || batch);
  useVisiblePolling({ intervalMs: 6000, enabled: running, onPoll: load });

  async function syncResource(resource: SellfoxSyncResource) {
    const response = await fetch("/api/sellfox/sync", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        resource, workspaceId: scope.workspaceId,
        ...(dateSensitive.has(resource) ? { startDate: from, endDate: to } : {}),
        ...(resource.startsWith("ads_") ? { adTypes: ["sp"] } : {}),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "同步任务创建失败。");
    return payload.runId as string;
  }

  async function syncOne(resource: SellfoxSyncResource) {
    if (!canSync || busy || batch) return;
    setBusy(resource); setNotice(""); setError(""); setSyncFeedback(null);
    try {
      const runId = await syncResource(resource);
      const message = `同步任务已入队，任务号 ${runId}；执行进度见同步记录。`;
      setNotice(message);
      setSyncFeedback({ resource, message, failed: false });
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "同步任务创建失败。";
      setError(message);
      setSyncFeedback({ resource, message, failed: true });
    }
    finally { setBusy(""); }
  }

  async function syncAll() {
    if (!canSync || batch || busy) return;
    const targets = (data?.datasets ?? []).map((dataset) => dataset.resource);
    const queue = [...new Set(["stores", ...targets])] as SellfoxSyncResource[];
    setError(""); setNotice("");
    for (let index = 0; index < queue.length; index += 1) {
      setBatch({ index: index + 1, total: queue.length, current: queue[index] });
      try { await syncResource(queue[index]); } catch (cause) { setError(`${queue[index]}：${cause instanceof Error ? cause.message : "提交失败"}`); }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    setBatch(null); setNotice("全量同步任务已按数据域依次入队，Worker 会串行执行并遵守 1 请求/1.2 秒限流。");
    await load();
  }

  const groups = useMemo(() => (activeGroup === "all" ? sellfoxPlanGroups : sellfoxPlanGroups.filter((group) => group.id === activeGroup)), [activeGroup]);
  const totals = data?.datasets.reduce((acc, dataset) => ({ rows: acc.rows + dataset.rows, stores: Math.max(acc.stores, dataset.storesWithData) }), { rows: 0, stores: 0 });

  return <div className="sellfox-ui space-y-2">
    <header className="flex flex-wrap items-center justify-between gap-2 border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 border border-border px-2 py-1">
          <Store className="h-3.5 w-3.5 text-brand" />店铺 <b className="tabular-nums">{n(data?.storeCount)}</b>
        </span>
        <span className={`inline-flex items-center gap-1 border px-2 py-1 ${data?.configured ? "border-success/20 bg-success-soft text-success-ink" : "border-danger/20 bg-danger-soft text-danger-ink"}`}>
          {data?.configured ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          凭据 {data ? (data.configured ? `已配置 · ${data.credentialSource === "database" ? "数据库加密存储" : "环境变量"}` : "未配置") : "读取中"}
        </span>
        <span className={`inline-flex items-center gap-1 border px-2 py-1 ${data?.workerOnline ? "border-success/20 bg-success-soft text-success-ink" : "border-accent/20 bg-warning-soft text-warning-ink"}`}>
          <Clock3 className="h-3.5 w-3.5" />Worker {data ? (data.workerOnline ? "在线" : "未启动") : "—"}
        </span>
        <span className="text-muted">上游限流 1 请求 / 1.2 秒，全量同步按数据域串行执行</span>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <label className="flex items-center gap-1 text-muted">日期
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-7 border border-border px-1.5" />
          <span>至</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-7 border border-border px-1.5" />
        </label>
        <button type="button" onClick={() => void load()} className="inline-flex h-7 items-center gap-1 border border-border px-2 hover:border-brand hover:text-brand">
          <RefreshCw className="h-3.5 w-3.5" />刷新
        </button>
        <button type="button" disabled={!canSync || Boolean(batch) || Boolean(busy)} onClick={() => void syncAll()} className="inline-flex h-7 items-center gap-1 bg-brand px-2.5 text-white disabled:cursor-not-allowed disabled:opacity-50">
          {batch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
          {batch ? `全量同步 ${batch.index}/${batch.total} · ${batch.current}` : "全量同步"}
        </button>
      </div>
    </header>

    {error || loadError ? <div role="alert" className="border border-danger/20 bg-danger-soft px-3 py-2 text-xs text-danger-ink">{error || loadError}</div> : null}
    {notice ? <div role="status" className="border border-success/20 bg-success-soft px-3 py-2 text-xs text-success-ink">{notice}</div> : null}
    {data && !data.configured ? <div className="border border-accent/20 bg-warning-soft px-3 py-2 text-xs text-warning-ink">赛狐凭据不可用，请在集成设置中重新保存 App ID / Secret。</div> : null}

    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
      {[
        { label: "店铺", value: data?.storeCount, hint: "Amazon 店铺授权数" },
        { label: "在线产品", value: data?.datasets.find((item) => item.key === "listings")?.rows, hint: "Listing 快照行数" },
        { label: "订单", value: data?.datasets.find((item) => item.key === "orders")?.rows, hint: "订单行（含明细）" },
        { label: "销量快照", value: data?.datasets.find((item) => item.key === "sales")?.rows, hint: "店铺 × 日 × MSKU" },
        { label: "利润快照", value: data?.datasets.find((item) => item.key === "performance")?.rows, hint: "产品维度日利润" },
        { label: "广告日报", value: data?.datasets.filter((item) => item.key.startsWith("ads_")).reduce((sum, item) => sum + item.rows, 0), hint: "SP/SB/SD 六类报告" },
      ].map((card) => <div key={card.label} className="border border-border bg-surface px-3 py-2">
        <p className="text-label text-muted">{card.label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{loading ? "…" : n(card.value)}</p>
        <p className="mt-0.5 text-label text-muted">{card.hint}</p>
      </div>)}
    </section>

    <div className="grid gap-2 lg:grid-cols-[190px_minmax(0,1fr)]">
      <aside className="border border-border bg-surface">
        <p className="border-b border-border px-3 py-2 text-label font-semibold text-muted">数据域导航</p>
        <nav className="divide-y divide-border text-xs">
          <button type="button" onClick={() => setActiveGroup("all")} className={`flex w-full items-center justify-between px-3 py-2 text-left ${activeGroup === "all" ? "bg-info-soft text-brand" : "hover:bg-surface-muted"}`}>
            <span>全部数据域</span><span className="tabular-nums text-label">{data?.plan.total ?? 0}</span>
          </button>
          {sellfoxPlanGroups.map((group) => {
            const live = group.items.filter((item) => item.status === "live").length;
            return <button key={group.id} type="button" onClick={() => setActiveGroup(group.id)} className={`flex w-full items-center justify-between px-3 py-2 text-left ${activeGroup === group.id ? "bg-info-soft text-brand" : "hover:bg-surface-muted"}`}>
              <span>{group.label}</span><span className="tabular-nums text-label text-muted">{live}/{group.items.length}</span>
            </button>;
          })}
        </nav>
        <div className="border-t border-border px-3 py-2 text-label leading-4 text-muted">
          规划 {data?.plan.total ?? 0} 个数据域：已接入 {data?.plan.live ?? 0}、待接入 {data?.plan.planned ?? 0}、需授权 {data?.plan.blocked ?? 0}。
        </div>
      </aside>

      <div className="min-w-0 space-y-2">
        <section className="border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-xs font-semibold">已接入数据域 · 同步状态</h2>
            <span className="text-label text-muted">覆盖店铺取该表 distinct 店铺数 / {data?.storeCount ?? 0}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-label">
              <thead className="bg-surface-muted text-muted">
                <tr>{["数据域", "落表", "行数", "覆盖店铺", "最新业务日期", "最近同步", "状态", "操作"].map((label) => <th key={label} className="whitespace-nowrap border-b border-border px-2 py-1.5 text-left font-medium">{label}</th>)}</tr>
              </thead>
              <tbody>
                {(data?.datasets ?? []).map((dataset) => {
                  const active = dataset.lastRun?.status === "running" || dataset.lastRun?.status === "queued";
                  return <tr key={dataset.key} className="hover:bg-surface-muted">
                    <td className="whitespace-nowrap border-b border-border px-2 py-1.5 font-medium">{dataset.label}</td>
                    <td className="whitespace-nowrap border-b border-border px-2 py-1.5 text-muted">{dataset.table}</td>
                    <td className="whitespace-nowrap border-b border-border px-2 py-1.5 tabular-nums">{n(dataset.rows)}</td>
                    <td className="whitespace-nowrap border-b border-border px-2 py-1.5 tabular-nums">{dataset.storesWithData}/{data?.storeCount ?? 0}</td>
                    <td className="whitespace-nowrap border-b border-border px-2 py-1.5 tabular-nums">{dataset.latest ?? "—"}</td>
                    <td className="whitespace-nowrap border-b border-border px-2 py-1.5 tabular-nums">{fmt(dataset.lastRun?.finishedAt ?? dataset.lastRun?.startedAt)}</td>
                    <td className="whitespace-nowrap border-b border-border px-2 py-1.5">
                      <span className={`inline-block border px-1.5 py-0.5 text-label ${active ? "border-info/20 bg-info-soft text-info-ink" : dataset.lastRun?.status === "failed" ? "border-danger/20 bg-danger-soft text-danger-ink" : dataset.rows > 0 ? "border-success/20 bg-success-soft text-success-ink" : "border-border bg-surface-muted text-muted"}`}>
                        {dataset.lastRun ? (runStatusText[dataset.lastRun.status] ?? dataset.lastRun.status) : "未同步"}
                      </span>
                      {dataset.lastRun?.error ? <span className="ml-1 text-label text-danger-ink" title={dataset.lastRun.error}>异常</span> : null}
                    </td>
                    <td className="whitespace-nowrap border-b border-border px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={!canSync || Boolean(busy) || active} onClick={() => void syncOne(dataset.resource)} className="text-brand disabled:cursor-not-allowed disabled:opacity-40">
                          {busy === dataset.resource ? "提交中" : "同步"}
                        </button>
                        {dataset.href ? <a href={dataset.href} className="inline-flex items-center gap-0.5 text-muted hover:text-brand">查看<ArrowUpRight className="h-3 w-3" /></a> : null}
                      </div>
                    </td>
                  </tr>;
                })}
                {!data?.datasets.length ? <tr><td colSpan={8} className="px-2 py-6 text-center text-muted">{loading ? "读取中…" : "暂无已接入数据域。"}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-3 py-1.5 text-label text-muted">合计 {n(totals?.rows)} 行快照；小时广告明细 {n(data?.hourlyRows)} 行。日期范围仅对销量/利润/订单/广告生效，库存与 Listing 只能取当前状态。</p>
        </section>

        <section className="border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-xs font-semibold">同步记录</h2>
            <span className="text-label text-muted">最近 20 次</span>
          </div>
          <div className="max-h-[260px] overflow-y-auto">
            <table className="w-full min-w-[720px] border-collapse text-label">
              <thead className="sticky top-0 bg-surface-muted text-muted">
                <tr>{["数据域", "状态", "开始", "结束", "进度/结果", "错误"].map((label) => <th key={label} className="border-b border-border px-2 py-1.5 text-left font-medium">{label}</th>)}</tr>
              </thead>
              <tbody>
                {(data?.runs ?? []).map((run) => <tr key={run.id} className="hover:bg-surface-muted">
                  <td className="whitespace-nowrap border-b border-border px-2 py-1.5">{run.resource}</td>
                  <td className="whitespace-nowrap border-b border-border px-2 py-1.5">{runStatusText[run.status] ?? run.status}</td>
                  <td className="whitespace-nowrap border-b border-border px-2 py-1.5 tabular-nums">{fmt(run.startedAt)}</td>
                  <td className="whitespace-nowrap border-b border-border px-2 py-1.5 tabular-nums">{fmt(run.finishedAt)}</td>
                  <td className="max-w-[220px] truncate border-b border-border px-2 py-1.5 tabular-nums">{run.progress ?? (run.result ? JSON.stringify(run.result).slice(0, 80) : "—")}</td>
                  <td className="max-w-[240px] truncate border-b border-border px-2 py-1.5 text-danger-ink" title={run.error ?? ""}>{run.error ?? ""}</td>
                </tr>)}
                {!data?.runs.length ? <tr><td colSpan={6} className="px-2 py-6 text-center text-muted">{loading ? "读取中…" : "暂无同步记录，点击「全量同步」开始。"}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-xs font-semibold">全量数据域规划</h2>
            <span className="text-label text-muted">已接入即可拉取；待接入为文档已确认的下一步；需授权依赖赛狐后台或平台侧开通</span>
          </div>
          <div className="divide-y divide-border">
            {groups.map((group) => <div key={group.id} className="px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-label font-semibold">{group.label}</h3>
                <span className="text-label text-muted">{group.hint}</span>
              </div>
              <div className="mt-1 grid gap-1 md:grid-cols-2">
                {group.items.map((item: SellfoxPlanItem) => <div key={item.id} className="flex items-start justify-between gap-2 border border-border px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 text-label font-medium">
                      {item.label}
                      <span className={`border px-1 text-label ${statusMeta[item.status].className}`}>{statusMeta[item.status].label}</span>
                      <span className="text-label text-muted">{item.priority}</span>
                    </p>
                    <p className="truncate text-label text-muted" title={item.api.join(" · ")}>{item.api.join(" · ")}</p>
                    {item.note ? <p className="text-label text-muted">{item.note}</p> : null}
                    {syncFeedback && syncFeedback.resource === item.resource ? <p role={syncFeedback.failed ? "alert" : "status"} className={`mt-1 break-all text-label ${syncFeedback.failed ? "text-danger-ink" : "text-success-ink"}`}>{syncFeedback.message}</p> : null}
                  </div>
                  {item.resource ? <button type="button" disabled={!canSync || Boolean(busy) || Boolean(batch)} title={!canSync ? "当前角色没有同步权限" : undefined} onClick={() => void syncOne(item.resource!)} className="shrink-0 text-label text-brand disabled:opacity-40">{busy === item.resource ? "提交中" : "同步"}</button> : null}
                  {item.href ? <a href={item.href} className="shrink-0 text-label text-muted hover:text-brand">查看</a> : null}
                </div>)}
              </div>
            </div>)}
          </div>
        </section>

        <section className="border border-border bg-surface px-3 py-2 text-label leading-5 text-muted">
          <p className="text-label font-semibold text-foreground">拉取口径</p>
          <p>· 所有数据经服务端后台调用赛狐 Open API，Access Token 只留在服务端并按 24 小时有效期缓存；前端不接触 Token。</p>
          <p>· 每个数据域独立落表，按店铺 + 业务日期 + 业务主键幂等写入，重复同步只覆盖同一快照，不会产生重复行。</p>
          <p>· 全局单飞限流（PG advisory lock + 1.2 秒间隔）：39 店 × 30 天销量约 1,170 次请求 ≈ 25 分钟；利润双口径约 45 分钟；六类广告报告取决于赛狐出表时间。</p>
        </section>
      </div>
    </div>
  </div>;
}
