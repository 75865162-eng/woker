"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, CloudCog, LockKeyhole, PackageSearch, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { amazonReadDomains, type AmazonReadDomain, type AmazonSyncResource, type DomainFreshnessSummary, type OperationsDailyMetric, type OperationsReadiness, type OperationsSyncRun } from "@/lib/operations/types";

import { SyncSchedulesPanel } from "./sync-schedules-panel";
import { ReplenishmentPanel } from "./replenishment-panel";
import { AmazonProductsPanel } from "./amazon-products-panel";

type BadgeTone = "blue" | "green" | "amber" | "red" | "gray";
type InventorySnapshot = {
  id: string;
  sellerSku: string;
  asin: string;
  fnSku: string;
  condition: string;
  fulfillableQuantity: number;
  inboundWorkingQuantity: number;
  inboundShippedQuantity: number;
  inboundReceivingQuantity: number;
  reservedQuantity: number;
  unfulfillableQuantity: number;
  capturedAt: string;
};
type InventoryResponse = {
  rows: InventorySnapshot[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  snapshot: { status: "NOT_SYNCED" | "FRESH" | "STALE"; syncRunId: string | null; capturedAt: string | null };
};
type MetricsResponse = {
  rows: OperationsDailyMetric[];
  pagination: { page: number; pageSize: number; hasNextPage: boolean };
  sourceNote: string;
  emptyReason: string | null;
};

const workspaceScopeStorageKey = "amazon_bulk_ad_workspace_scope";

function workspaceHeaders() {
  const headers = new Headers();
  try {
    const scope = JSON.parse(window.localStorage.getItem(workspaceScopeStorageKey) ?? "{}") as { workspaceId?: string; accountId?: string; marketplace?: string };
    headers.set("x-workspace-id", scope.workspaceId || "default");
    if (scope.accountId) headers.set("x-account-id", scope.accountId);
    if (scope.marketplace) headers.set("x-marketplace", scope.marketplace);
  } catch {
    headers.set("x-workspace-id", "default");
  }
  return headers;
}

function formatDateTime(value: string | null) {
  if (!value) return "尚无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间不可用" : date.toLocaleString("zh-CN", { hour12: false });
}

function initialDate(offset = 0) {
  const date = new Date(Date.now() - offset * 86_400_000);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function freshnessBadge(status: DomainFreshnessSummary["status"]): { tone: BadgeTone; label: string } {
  if (status === "SYNCING") return { tone: "blue", label: "SYNCING · 同步中" };
  if (status === "DISABLED") return { tone: "gray", label: "DISABLED · 已停用" };
  if (status === "FRESH") return { tone: "green", label: "新鲜" };
  if (status === "STALE") return { tone: "amber", label: "已过期" };
  if (status === "FAILED") return { tone: "red", label: "失败" };
  if (status === "BLOCKED") return { tone: "gray", label: "未接通" };
  return { tone: "gray", label: "未同步" };
}

function runBadge(status: OperationsSyncRun["status"]): { tone: BadgeTone; label: string } {
  if (status === "SUCCEEDED") return { tone: "green", label: "成功" };
  if (status === "FAILED") return { tone: "red", label: "失败" };
  if (status === "BLOCKED") return { tone: "amber", label: "已阻断" };
  if (status === "RUNNING") return { tone: "blue", label: "执行中" };
  return { tone: "gray", label: "排队中" };
}

function resourceLabel(resource: AmazonSyncResource) {
  const labels: Record<AmazonSyncResource, string> = {
    readiness: "连接校验", ads: "广告", orders: "订单", inventory: "库存", catalog: "商品目录", finance: "财务", fulfillment: "履约",
  };
  return labels[resource];
}

function freshnessReason(domain: DomainFreshnessSummary) {
  return domain.reason || domain.lastAttemptError || "暂无异常。";
}

function money(value: number | null, currency: string) {
  if (value === null) return "—";
  if (!currency) return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

export function OperationsHubWorkbench() {
  const [tab, setTab] = useState("overview");
  const [runResource, setRunResource] = useState("");
  const [runStatus, setRunStatus] = useState("");
  const [runDate, setRunDate] = useState("");
  const requests = useRef({ readiness: 0, inventory: 0, metrics: 0, scope: 0 });
  useEffect(() => {
    const update = () => setTab(new URLSearchParams(window.location.search).get("tab") || "overview");
    update(); window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const [readiness, setReadiness] = useState<OperationsReadiness | null>(null);
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [selectedResource, setSelectedResource] = useState<AmazonReadDomain>("inventory");
  const [requesting, setRequesting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [inventorySkuInput, setInventorySkuInput] = useState("");
  const [inventorySku, setInventorySku] = useState("");
  const [inventoryPage, setInventoryPage] = useState(1);
  const [metricSkuInput, setMetricSkuInput] = useState("");
  const [metricAsinInput, setMetricAsinInput] = useState("");
  const [metricSku, setMetricSku] = useState("");
  const [metricAsin, setMetricAsin] = useState("");
  const [metricFrom, setMetricFrom] = useState(() => initialDate(6));
  const [metricTo, setMetricTo] = useState(() => initialDate());
  const [metricPage, setMetricPage] = useState(1);
  const [scopeRevision, setScopeRevision] = useState(0);

  const loadReadiness = useCallback(async () => {
    const sequence = ++requests.current.readiness;
    const scopeKey = workspaceHeaders().get("x-workspace-id");
    try {
      const response = await fetch("/api/operations/freshness", { cache: "no-store", headers: workspaceHeaders() });
      const payload = (await response.json()) as OperationsReadiness & { error?: string };
      if (sequence !== requests.current.readiness || scopeKey !== workspaceHeaders().get("x-workspace-id")) return;
      if (!response.ok) throw new Error(payload.error || "经营中台状态读取失败。");
      setReadiness(payload);
    } catch (error) {
      if (sequence === requests.current.readiness && scopeKey === workspaceHeaders().get("x-workspace-id")) throw error;
    }
  }, []);

  const loadInventory = useCallback(async () => {
    const sequence = ++requests.current.inventory;
    const scopeKey = workspaceHeaders().get("x-workspace-id");
    setInventoryLoading(true);
    try {
      const params = new URLSearchParams({ page: String(inventoryPage), pageSize: "20" });
      if (inventorySku) params.set("sku", inventorySku);
      const response = await fetch(`/api/operations/inventory/snapshots?${params}`, { cache: "no-store", headers: workspaceHeaders() });
      const payload = (await response.json()) as InventoryResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "库存快照读取失败。");
      if (sequence !== requests.current.inventory || scopeKey !== workspaceHeaders().get("x-workspace-id")) return;
      setInventory(payload);
    } catch (error) {
      if (sequence === requests.current.inventory && scopeKey === workspaceHeaders().get("x-workspace-id")) {
        setNotice(error instanceof Error ? error.message : "库存快照读取失败。");
      }
    } finally {
      if (sequence === requests.current.inventory && scopeKey === workspaceHeaders().get("x-workspace-id")) setInventoryLoading(false);
    }
  }, [inventoryPage, inventorySku]);

  const loadMetrics = useCallback(async () => {
    const sequence = ++requests.current.metrics;
    const scopeKey = workspaceHeaders().get("x-workspace-id");
    setMetricsLoading(true);
    try {
      const params = new URLSearchParams({ from: metricFrom, to: metricTo, page: String(metricPage), pageSize: "30" });
      if (metricSku) params.set("sku", metricSku);
      if (metricAsin) params.set("asin", metricAsin);
      const response = await fetch(`/api/operations/metrics/daily?${params}`, { cache: "no-store", headers: workspaceHeaders() });
      const payload = (await response.json()) as MetricsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "日经营指标读取失败。");
      if (sequence !== requests.current.metrics || scopeKey !== workspaceHeaders().get("x-workspace-id")) return;
      setMetrics(payload);
    } catch (error) {
      if (sequence === requests.current.metrics && scopeKey === workspaceHeaders().get("x-workspace-id")) {
        setNotice(error instanceof Error ? error.message : "日经营指标读取失败。");
      }
    } finally {
      if (sequence === requests.current.metrics && scopeKey === workspaceHeaders().get("x-workspace-id")) setMetricsLoading(false);
    }
  }, [metricAsin, metricFrom, metricPage, metricSku, metricTo]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadReadiness().catch((error) => {
      if (!cancelled) setNotice(error instanceof Error ? error.message : "经营中台状态读取失败。");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadReadiness, scopeRevision]);

  useEffect(() => {
    const timer = window.setInterval(() => { void loadReadiness().catch(() => undefined); }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadReadiness]);

  useEffect(() => { void loadInventory(); }, [loadInventory, scopeRevision]);
  useEffect(() => { void loadMetrics(); }, [loadMetrics, scopeRevision]);
  useEffect(() => {
    const reload = () => {
      requests.current.readiness++; requests.current.inventory++; requests.current.metrics++; requests.current.scope++;
      setRequesting(false); setValidating(false);
      setReadiness(null); setInventory(null); setMetrics(null); setNotice("");
      setInventoryPage(1); setMetricPage(1); setScopeRevision((current) => current + 1);
    };
    window.addEventListener(workspaceScopeChangedEventName, reload);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reload);
  }, []);

  async function refreshAll() {
    await Promise.all([loadReadiness(), loadInventory(), loadMetrics()]).catch((error) => {
      setNotice(error instanceof Error ? error.message : "经营中台刷新失败。");
    });
  }

  async function requestSync(resource = selectedResource) {
    const scope = requests.current.scope;
    setRequesting(true);
    setNotice("");
    try {
      const response = await fetch("/api/operations/sync-runs", {
        method: "POST",
        headers: new Headers([...workspaceHeaders(), ["Content-Type", "application/json"]]),
        body: JSON.stringify({ resource, idempotencyKey: `manual-${resource}-${crypto.randomUUID()}` }),
      });
      const payload = (await response.json()) as { run?: OperationsSyncRun; error?: string };
      if (scope !== requests.current.scope) return;
      if (!response.ok || !payload.run) throw new Error(payload.error || "同步请求创建失败。");
      setNotice(payload.run.error || "同步请求已创建。");
      await refreshAll();
    } catch (error) {
      if (scope === requests.current.scope) setNotice(error instanceof Error ? error.message : "同步请求创建失败。");
    } finally {
      if (scope === requests.current.scope) setRequesting(false);
    }
  }

  async function validateConnection() {
    const scope = requests.current.scope;
    setValidating(true);
    setNotice("");
    try {
      const response = await fetch("/api/operations/connection/validate", { method: "POST", headers: workspaceHeaders() });
      const payload = (await response.json()) as { error?: string };
      if (scope !== requests.current.scope) return;
      if (!response.ok) throw new Error(payload.error || "Amazon 连接校验失败。");
      setNotice("Amazon 连接校验完成。商品与库存执行器已就绪；未绑定 Seller ID/店铺/站点时同步将明确阻断。");
      await refreshAll();
    } catch (error) {
      if (scope === requests.current.scope) setNotice(error instanceof Error ? error.message : "Amazon 连接校验失败。");
    } finally {
      if (scope === requests.current.scope) setValidating(false);
    }
  }

  const inventoryQuantity = (value?: number) => readiness && readiness.inventory.status !== "NOT_SYNCED" && value !== undefined ? value.toLocaleString("zh-CN") : "未同步";

  const connectionTone: { tone: BadgeTone; label: string } = readiness
    ? readiness.connection.status === "CONFIGURED" ? { tone: "green", label: "连接已验证" }
      : readiness.connection.status === "ERROR" ? { tone: "red", label: "连接异常" }
        : readiness.connection.status === "DISABLED" ? { tone: "gray", label: "已停用" }
          : { tone: "amber", label: "未配置" }
    : { tone: "gray", label: loading ? "读取中" : "不可用" };

  return (
    <div className="space-y-5">
      <nav aria-label="经营中台分区" className="flex flex-wrap gap-2 border-b border-border pb-3">
        {[["overview", "概览"], ["sync", "同步与计划"], ["inventory", "库存"], ["ads", "广告联看"], ["orders", "订单"], ["catalog", "在线产品"], ["replenishment", "补货计划"], ["runs", "同步历史"]].map(([key, label]) => <a key={key} href={`?tab=${key}`} aria-current={tab === key ? "page" : undefined} className={`rounded px-3 py-2 text-sm ${tab === key ? "bg-brand text-white" : "text-muted"}`} onClick={(event) => { event.preventDefault(); window.history.pushState(null, "", `?tab=${key}`); setTab(key); }}>{label}</a>)}
        <Button size="sm" variant="secondary" onClick={() => void refreshAll()} disabled={requesting}>刷新数据</Button>
      </nav>
      {tab === "sync" && <SyncSchedulesPanel key={scopeRevision} headers={workspaceHeaders} onSync={(resource) => void requestSync(resource ?? "inventory")} onChanged={() => void refreshAll()} />}
      {tab === "replenishment" && <ReplenishmentPanel key={scopeRevision} headers={workspaceHeaders} />}
      {tab === "catalog" && <AmazonProductsPanel key={scopeRevision} headers={workspaceHeaders} />}
      {tab === "orders" && <section className="border border-border p-5"><h3 className="text-sm font-bold">{tab === "orders" ? "订单 · NOT_SYNCED" : "在线产品 · NOT_SYNCED"}</h3><p className="mt-2 text-sm text-muted">{tab === "orders" ? "订单 worker 尚未接入。计划频率 15–30 分钟；接入后提供近 7/30 天订单量、件数、销售额，Pending 订单口径另行标注。" : "Amazon Listing 快照，非公司主数据，不写入产品中心。计划日更，worker 未就绪前保持关闭。"}</p></section>}

      {notice ? (
        <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{notice}</p>
        </div>
      ) : null}

      <section hidden={tab !== "overview"} className="border-b border-border pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand text-white"><CloudCog className="h-5 w-5" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-bold text-foreground">连接健康</h2><Badge tone={connectionTone.tone}>{connectionTone.label}</Badge></div>
              <p className="mt-1 text-sm text-muted">工作区：{readiness?.scope.workspaceId ?? "读取中"} · {[readiness?.scope.marketplace, readiness?.scope.accountId].filter(Boolean).join(" / ") || "未限定站点与账号"}</p>
              <p className="mt-1 text-xs text-muted">Amazon 凭证仅由服务端使用；本中台只执行读取与同步，不写回 Amazon。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {readiness?.connection.runtimeConfiguration.configured && readiness.connection.status !== "CONFIGURED" ? (
              <Button size="sm" onClick={() => void validateConnection()} disabled={validating}><ShieldCheck className="h-4 w-4" />{validating ? "校验中..." : "验证 Amazon 连接"}</Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => void refreshAll()} disabled={loading || inventoryLoading || metricsLoading}><RefreshCw className="h-4 w-4" />刷新</Button>
          </div>
        </div>

        {!readiness?.connection.runtimeConfiguration.configured ? (
          <div className="mt-4 flex flex-wrap items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
            <div><p className="font-semibold">等待服务端 SP-API 配置</p><p className="mt-1 text-xs text-amber-800">页面只显示缺少的变量名，不会读取密钥值。</p><div className="mt-2 flex flex-wrap gap-2">{readiness?.connection.runtimeConfiguration.missingEnvironmentVariables.map((key) => <code key={key} className="border border-amber-200 bg-white px-2 py-1 text-xs">{key}</code>)}</div></div>
          </div>
        ) : null}

        <p className="mt-3 text-sm">最新可售库存：{readiness?.inventory.status && readiness.inventory.status !== "NOT_SYNCED" ? readiness.inventory.fulfillableQuantity.toLocaleString("zh-CN") : "未同步"} · 今日广告花费：未接通日投影 · 今日订单/销量：未同步</p>
        <div className="mt-4 grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-3">
          {amazonReadDomains.map((domain) => {
            const summary = readiness?.domains?.[domain];
            const badge = summary ? freshnessBadge(summary.status) : { tone: "gray" as const, label: "读取中" };
            return (
              <div key={domain} className="min-h-28 bg-white p-4">
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-bold text-foreground">{resourceLabel(domain)}</p><Badge tone={badge.tone}>{badge.label}</Badge></div>
                <p className="mt-2 text-xs text-muted">{summary?.source ?? (domain === "inventory" ? "Amazon SP-API" : domain === "ads" ? "现有 PPC 模块" : "Amazon SP-API")}</p>
                <p className="mt-1 text-xs text-muted">{freshnessReason(summary ?? { resource: domain, status: "NOT_SYNCED", source: null, syncRunId: null, lastSuccessAt: null, lastAttemptAt: null, lastAttemptStatus: null, lastAttemptError: null, reason: "状态读取中。", recommendedAction: null })}</p>
                <p className="mt-1 text-xs text-muted">下次计划：{summary?.nextScheduledAt ? formatDateTime(summary.nextScheduledAt) : "未启用"}</p>
                {summary?.lastSuccessAt ? <p className="mt-1 text-xs text-muted">最近成功：{formatDateTime(summary.lastSuccessAt)}</p> : null}
                {summary?.recommendedAction ? <p className="mt-1 text-xs font-medium text-foreground">建议：{summary.recommendedAction}</p> : null}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <p className="text-xs text-muted">Marketplace：{readiness?.connection.marketplaceParticipations.map((item) => `${item.countryCode} (${item.marketplaceId})`).join("、") || "尚未验证"}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-semibold text-muted">同步域<select value={selectedResource} onChange={(event) => setSelectedResource(event.target.value as AmazonReadDomain)} className="h-9 min-w-36 border border-border bg-white px-2 text-sm font-medium text-foreground"><option value="inventory">库存</option>{amazonReadDomains.filter((domain) => domain !== "inventory").map((domain) => <option key={domain} value={domain}>{resourceLabel(domain)}</option>)}</select></label>
            <Button size="sm" onClick={() => void requestSync()} disabled={requesting}><ShieldCheck className="h-4 w-4" />{requesting ? "提交中..." : "请求只读同步"}</Button>
          </div>
        </div>
      </section>

      <section hidden={tab !== "inventory"} className="border-b border-border pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="flex items-center gap-2"><PackageSearch className="h-4 w-4 text-brand" /><h3 className="text-sm font-bold text-foreground">库存</h3><Badge tone={freshnessBadge(readiness?.inventory.status === "FRESH" ? "FRESH" : readiness?.inventory.status === "STALE" ? "STALE" : "NOT_SYNCED").tone}>{readiness?.inventory.status === "FRESH" ? "新鲜" : readiness?.inventory.status === "STALE" ? "已过期" : "未同步"}</Badge></div>
            <p className="mt-1 text-xs text-muted">可售 {inventoryQuantity(readiness?.inventory.fulfillableQuantity)} · 在途 {inventoryQuantity(readiness?.inventory.inboundQuantity)} · 预留 {inventoryQuantity(readiness?.inventory.reservedQuantity)} · 不可售 {inventoryQuantity(readiness?.inventory.unfulfillableQuantity)}</p>
            <p className="mt-1 text-xs text-muted">快照时间：{formatDateTime(readiness?.inventory.capturedAt ?? null)} · 新鲜度沿用服务端阈值 · {readiness?.inventory.snapshotCount.toLocaleString("zh-CN") ?? 0} 个 SKU</p>
            {readiness?.domains.inventory.reason ? <p className="mt-1 text-xs text-amber-800">{readiness.domains.inventory.reason} {readiness.domains.inventory.recommendedAction}</p> : null}
            {readiness?.domains.inventory.lastAttemptError ? <p className="mt-1 text-xs text-red-700">最近同步失败：{readiness.domains.inventory.lastAttemptError}</p> : null}
          </div>
          <Button size="sm" onClick={() => void requestSync("inventory")} disabled={requesting}>立即同步库存</Button>
          <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); setInventoryPage(1); setInventorySku(inventorySkuInput.trim()); }}>
            <label className="grid gap-1 text-xs font-semibold text-muted">按 SKU 查询<input value={inventorySkuInput} onChange={(event) => setInventorySkuInput(event.target.value)} className="h-9 w-52 max-w-full border border-border px-3 text-sm text-foreground" placeholder="输入 Seller SKU" /></label>
            <Button size="sm" variant="secondary" type="submit"><PackageSearch className="h-4 w-4" />查询</Button>
          </form>
        </div>
        <div className="mt-4 overflow-x-auto border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted"><tr><th className="px-3 py-2.5">Seller SKU</th><th className="px-3 py-2.5">ASIN / FNSKU</th><th className="px-3 py-2.5 text-right">可售</th><th className="px-3 py-2.5 text-right">在途</th><th className="px-3 py-2.5 text-right">预留</th><th className="px-3 py-2.5 text-right">不可售</th><th className="px-3 py-2.5">快照时间</th></tr></thead>
            <tbody>{inventory?.rows.length ? inventory.rows.map((row) => <tr key={row.id} className="border-b border-border last:border-0"><td className="px-3 py-2.5 font-medium text-foreground">{row.sellerSku}</td><td className="px-3 py-2.5 text-muted">{row.asin || "—"}<span className="block text-xs">{row.fnSku || row.condition || ""}</span></td><td className="px-3 py-2.5 text-right tabular-nums">{row.fulfillableQuantity.toLocaleString("zh-CN")}</td><td className="px-3 py-2.5 text-right tabular-nums">{(row.inboundWorkingQuantity + row.inboundShippedQuantity + row.inboundReceivingQuantity).toLocaleString("zh-CN")}</td><td className="px-3 py-2.5 text-right tabular-nums">{row.reservedQuantity.toLocaleString("zh-CN")}</td><td className="px-3 py-2.5 text-right tabular-nums">{row.unfulfillableQuantity.toLocaleString("zh-CN")}</td><td className="px-3 py-2.5 text-xs text-muted">{formatDateTime(row.capturedAt)}</td></tr>) : <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-muted">{inventoryLoading ? "读取库存快照中..." : inventorySku ? "当前成功快照中没有匹配 SKU。" : "当前工作区暂无成功库存快照。"}</td></tr>}</tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted"><span>{inventory?.pagination.total ?? 0} 条 · 第 {inventory?.pagination.page ?? inventoryPage} / {Math.max(inventory?.pagination.pageCount ?? 0, 1)} 页</span><Button variant="secondary" size="sm" aria-label="上一页库存" onClick={() => setInventoryPage((page) => Math.max(1, page - 1))} disabled={inventoryPage <= 1 || inventoryLoading}><ChevronLeft className="h-4 w-4" /></Button><Button variant="secondary" size="sm" aria-label="下一页库存" onClick={() => setInventoryPage((page) => page + 1)} disabled={inventoryLoading || (inventory?.pagination.pageCount ?? 0) <= inventoryPage}><ChevronRight className="h-4 w-4" /></Button></div>
      </section>

      <section hidden={tab !== "ads"} className="border-b border-border pb-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold text-foreground">经营指标 · 广告 × 销量</h3><a href="/workspace" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">广告优化工作台<ArrowUpRight className="h-3.5 w-3.5" /></a></div><p className="mt-1 max-w-3xl text-xs text-muted">{metrics?.sourceNote ?? "现有 PPC 日粒度投影尚未接通；不另建广告同步。"} TACOS = 广告花费 ÷ 销售额。</p></div>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); setMetricPage(1); setMetricSku(metricSkuInput.trim()); setMetricAsin(metricAsinInput.trim()); }}>
            <label className="grid gap-1 text-xs font-semibold text-muted">开始日期<input type="date" value={metricFrom} onChange={(event) => setMetricFrom(event.target.value)} className="h-9 border border-border px-2 text-sm text-foreground" /></label>
            <label className="grid gap-1 text-xs font-semibold text-muted">结束日期<input type="date" value={metricTo} onChange={(event) => setMetricTo(event.target.value)} className="h-9 border border-border px-2 text-sm text-foreground" /></label>
            <label className="grid gap-1 text-xs font-semibold text-muted">SKU<input value={metricSkuInput} onChange={(event) => setMetricSkuInput(event.target.value)} className="h-9 w-32 border border-border px-2 text-sm text-foreground" /></label>
            <label className="grid gap-1 text-xs font-semibold text-muted">ASIN<input value={metricAsinInput} onChange={(event) => setMetricAsinInput(event.target.value)} className="h-9 w-32 border border-border px-2 text-sm text-foreground" /></label>
            <Button size="sm" variant="secondary" type="submit">查询</Button>
          </form>
        </div>
        <div className="mt-4 overflow-x-auto border border-border">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted"><tr><th className="px-3 py-2.5">日期</th><th className="px-3 py-2.5">SKU / ASIN</th><th className="px-3 py-2.5 text-right">销售额</th><th className="px-3 py-2.5 text-right">广告花费</th><th className="px-3 py-2.5 text-right">TACOS</th></tr></thead>
            <tbody>{metrics?.rows.length ? metrics.rows.map((row, index) => <tr key={`${row.date}:${row.sku}:${row.asin}:${row.currency}:${index}`} className="border-b border-border last:border-0"><td className="px-3 py-2.5 text-muted">{row.date}</td><td className="px-3 py-2.5 font-medium text-foreground">{row.sku || "—"}<span className="block text-xs text-muted">{row.asin || ""}</span></td><td className="px-3 py-2.5 text-right tabular-nums" title={row.fieldNotes.sales ?? undefined}>{money(row.sales, row.currency)}</td><td className="px-3 py-2.5 text-right tabular-nums" title={row.fieldNotes.adSpend ?? undefined}>{money(row.adSpend, row.currency)}</td><td className="px-3 py-2.5 text-right tabular-nums" title={row.fieldNotes.tacos ?? undefined}>{row.tacos === null ? "—" : `${row.tacos.toFixed(2)}%`}</td></tr>) : <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted">{metricsLoading ? "读取经营指标中..." : metrics?.emptyReason ?? "当前日期范围没有可读取指标。"}</td></tr>}</tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted"><span>第 {metricPage} 页</span><Button variant="secondary" size="sm" aria-label="上一页经营指标" onClick={() => setMetricPage((page) => Math.max(1, page - 1))} disabled={metricPage <= 1 || metricsLoading}><ChevronLeft className="h-4 w-4" /></Button><Button variant="secondary" size="sm" aria-label="下一页经营指标" onClick={() => setMetricPage((page) => page + 1)} disabled={metricsLoading || !metrics?.pagination.hasNextPage}><ChevronRight className="h-4 w-4" /></Button></div>
      </section>

      <section hidden={!["overview", "sync", "runs"].includes(tab)}>
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-foreground">同步历史</h3><span className="text-xs text-muted">最近 {readiness?.runs.length ?? 0} 条</span></div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs"><select aria-label="历史数据域" value={runResource} onChange={(e) => setRunResource(e.target.value)}><option value="">全部域</option>{amazonReadDomains.map((domain) => <option key={domain} value={domain}>{resourceLabel(domain)}</option>)}</select><select aria-label="历史状态" value={runStatus} onChange={(e) => setRunStatus(e.target.value)}><option value="">全部状态</option>{["SUCCEEDED", "FAILED", "BLOCKED", "QUEUED", "RUNNING"].map((status) => <option key={status}>{status}</option>)}</select><input aria-label="历史开始日期" type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} /><span className="text-muted">筛选最近 20 次运行</span></div>
        <div className="mt-3 overflow-x-auto border border-border">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted"><tr><th className="px-3 py-2.5">数据域</th><th className="px-3 py-2.5">状态</th><th className="px-3 py-2.5">请求时间</th><th className="px-3 py-2.5">结果 / 失败原因</th></tr></thead>
            <tbody>{readiness?.runs.length ? readiness.runs.filter((run) => (!runResource || run.resource === runResource) && (!runStatus || run.status === runStatus) && (!runDate || run.startedAt.slice(0, 10) >= runDate) && (tab !== "overview" || run.status === "FAILED" || run.status === "BLOCKED")).map((run) => { const badge = runBadge(run.status); return <tr key={run.id} className="border-b border-border last:border-0"><td className="px-3 py-2.5 font-medium text-foreground">{resourceLabel(run.resource)}</td><td className="px-3 py-2.5"><Badge tone={badge.tone}>{badge.label}</Badge></td><td className="px-3 py-2.5 text-muted">{formatDateTime(run.startedAt)}</td><td className="max-w-xl px-3 py-2.5 text-muted">{run.error || (run.status === "SUCCEEDED" ? "同步成功" : "等待执行结果")}<details className="mt-1 text-xs"><summary>运行详情</summary><p>{run.id} · 耗时：{run.finishedAt ? `${Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000))} 秒` : "执行中"}</p><pre className="whitespace-pre-wrap">{JSON.stringify(run.summary, null, 2)}</pre></details></td></tr>; }) : <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-muted"><CheckCircle2 className="mx-auto mb-2 h-5 w-5" />{loading ? "读取同步历史中..." : "暂无同步记录。"}</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
