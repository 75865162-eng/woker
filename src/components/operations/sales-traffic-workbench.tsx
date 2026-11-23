"use client";
import { formatSiteStore, siteCodeForDisplay } from "@/lib/sellfox/marketplace-site";
import { useEffect, useRef, useState } from "react";
import { useVisiblePolling } from "@/lib/hooks/use-visible-polling";
import { Button } from "@/components/ui/button";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { ReadinessNotice, readinessKindFromCode } from "@/components/operations/readiness-notice";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import type { SyncSourceView } from "@/lib/amazon-sync/contracts";
import type { SalesRow, SalesMatrix, SalesMatrixCell, SalesMatrixDimension, ProductSalesRow } from "@/lib/amazon-sync/sales-query";
const endpoint = "/api/operations/sync-center";
const input = "min-h-9 rounded border border-border bg-background px-2 text-sm";
const PENDING_DIMENSIONS = ["MSKU", "SPU", "开发员", "业务员"] as const;
const METRICS = [{ key: "units", label: "销量" }, { key: "orders", label: "订单商品项数" }, { key: "revenue", label: "销售额" }, { key: "sessions", label: "Sessions" }] as const;
type MetricKey = typeof METRICS[number]["key"];
function scopeHeaders() {
  const headers = new Headers({ "content-type": "application/json" });
  try { headers.set("x-workspace-id", JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}").workspaceId || "default"); } catch { headers.set("x-workspace-id", "default"); }
  return headers;
}
type Result = { rows: SalesRow[]; pagination: { pageCount: number; total: number }; asOf: string };
type ProductResult = { rows: ProductSalesRow[]; pagination: { pageCount: number; total: number }; asOf: string; granularity: string };
type ExportState = { id: string; status: string; rowCount?: number; error?: string };
function cellValue(cell: SalesMatrixCell | undefined, metric: MetricKey): string {
  if (!cell) return "—";
  if (metric === "units") return cell.unitsOrdered ?? "—";
  if (metric === "orders") return cell.totalOrderItems ?? "—";
  if (metric === "revenue") return cell.orderedProductSales ? `${cell.orderedProductSales.amount} ${cell.orderedProductSales.currencyCode}` : "—";
  return cell.sessions ?? "—";
}
export function SalesTrafficWorkbench({ sources, canSync, canExport, taskId, onTask }: { sources: SyncSourceView[]; canSync: boolean; canExport: boolean; taskId?: string; onTask?: (id: string) => void }) {
  const [seller, setSeller] = useState(""), [site, setSite] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [keyword, setKeyword] = useState(""), [direction, setDirection] = useState("desc");
  const [source, setSource] = useState(""), [preset, setPreset] = useState("yesterday"), [syncFrom, setSyncFrom] = useState(""), [syncTo, setSyncTo] = useState("");
  const [page, setPage] = useState(1), [reload, setReload] = useState(0), [result, setResult] = useState<Result | null>(null), [matrix, setMatrix] = useState<SalesMatrix | null>(null), [productResult, setProductResult] = useState<ProductResult | null>(null), [error, setError] = useState(""), [errorCode, setErrorCode] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [job, setJob] = useState<ExportState | null>(null);
  const [view, setView] = useState<"rows" | "matrix" | "products">("rows"), [metric, setMetric] = useState<MetricKey>("units");
  const [productDim, setProductDim] = useState<"ASIN" | "父ASIN" | "SKU">("ASIN"), [syncGranularity, setSyncGranularity] = useState<"CHILD" | "SKU">("CHILD");
  const [productKeyword, setProductKeyword] = useState("");
  const sequence = useRef(0), mutation = useRef(0);
  const filters = { sellerAccountId: seller, marketplaceId: site, from, to, keyword, direction, ...(taskId ? { taskId } : {}) };
  const queryKey = JSON.stringify(filters);
  useEffect(() => { const requests = sequence, mutations = mutation; const reset = () => { ++requests.current; ++mutations.current; setResult(null); setMatrix(null); setProductResult(null); setJob(null); setError(""); setErrorCode(""); setNotice(""); setBusy(false); setPage(1); setSeller(""); setSite(""); setSource(""); setReload(v => v + 1); }; window.addEventListener(workspaceScopeChangedEventName, reset); return () => { ++requests.current; ++mutations.current; window.removeEventListener(workspaceScopeChangedEventName, reset); }; }, []);
  useEffect(() => {
    const n = ++sequence.current, controller = new AbortController(); setLoading(true); setResult(null); setMatrix(null); setProductResult(null); setError(""); setErrorCode("");
    const section = view === "matrix" ? "sales-traffic-matrix" : view === "products" ? "sales-traffic-products" : "sales-traffic";
    const params = new URLSearchParams({ section, ...(view === "rows" || view === "products" ? { page: String(page) } : {}), ...JSON.parse(queryKey), ...(view === "products" ? { granularity: productDim === "SKU" ? "SKU" : "CHILD", ...(productDim === "SKU" && productKeyword.trim() ? { sellerSku: productKeyword.trim() } : {}) } : {}) });
    void fetch(`${endpoint}?${params}`, { headers: scopeHeaders(), cache: "no-store", signal: controller.signal }).then(async response => { const payload = await response.json(); if (!response.ok) { const failure = new Error(payload.error ?? "销售流量读取失败。") as Error & { code?: string }; failure.code = payload.code; throw failure; } if (n === sequence.current) { if (view === "matrix") setMatrix(payload as SalesMatrix); else if (view === "products") setProductResult(payload as ProductResult); else setResult(payload as Result); } }).catch(e => { if (n === sequence.current && !controller.signal.aborted) { setError(e instanceof Error ? e.message : "读取失败。"); setErrorCode((e as Error & { code?: string }).code ?? ""); } }).finally(() => { if (n === sequence.current) setLoading(false); });
    return () => { controller.abort(); };
  }, [queryKey, page, reload, view, productDim, productKeyword]);
  useVisiblePolling({
    intervalMs: 3000,
    enabled: Boolean(job && ["QUEUED", "RUNNING"].includes(job.status)),
    onPoll: () => {
      if (!job) return;
      void fetch(`${endpoint}/exports?id=${encodeURIComponent(job.id)}`, { headers: scopeHeaders(), cache: "no-store" }).then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error ?? "导出状态读取失败。"); setJob(p); }).catch(e => { setError(e instanceof Error ? e.message : "导出状态读取失败。"); });
    },
  });
  const requestSync = async () => {
    const n = ++mutation.current; setBusy(true); setError(""); setNotice("");
    try {
      const granularityField = preset === "yesterday" || preset === "today" || preset === "custom" ? { asinGranularity: syncGranularity } : {};
      const r = await fetch(endpoint, { method: "POST", headers: scopeHeaders(), body: JSON.stringify({ action: "run", sourceIds: [source], datePreset: preset, ...granularityField, ...(preset === "custom" ? { dateFrom: syncFrom, dateTo: syncTo } : {}) }) });
      const p = await r.json(); if (!r.ok) throw new Error(p.error ?? "同步申请失败。");
      if (n === mutation.current) setNotice(p.approvalRequired ? "同步申请已提交，等待系统处理。" : "已提交，系统正在同步 Amazon 数据（无需人工审批）。");
    } catch (e) { if (n === mutation.current) setError(e instanceof Error ? e.message : "同步申请失败。"); }
    finally { if (n === mutation.current) setBusy(false); }
  };
  const exportData = async () => {
    const n = ++mutation.current; setBusy(true); setError("");
    try {
      const r = await fetch(`${endpoint}/exports`, { method: "POST", headers: scopeHeaders(), body: JSON.stringify({ filters, asOf: result?.asOf ?? matrix?.asOf, idempotencyKey: crypto.randomUUID() }) }); const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? "导出申请失败。"); if (n === mutation.current) setJob(p);
    } catch (e) { if (n === mutation.current) setError(e instanceof Error ? e.message : "导出失败。"); }
    finally { if (n === mutation.current) setBusy(false); }
  };
  const download = async () => {
    if (!job) return; const n = ++mutation.current; setBusy(true);
    try {
      const r = await fetch(`${endpoint}/exports?id=${encodeURIComponent(job.id)}&download=1`, { headers: scopeHeaders(), cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error ?? "下载失败。");
      const blob = await r.blob(); if (n !== mutation.current) return;
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `amazon-sales-${job.id}.jsonl`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { if (n === mutation.current) setError(e instanceof Error ? e.message : "下载失败。"); }
    finally { if (n === mutation.current) setBusy(false); }
  };
  const select = (set: (s: string) => void, value: string) => { set(value); setPage(1); };
  const salesColumns: DataTableColumn<SalesRow>[] = [
    {
      key: "businessDate",
      header: "业务日 / 来源",
      render: (row) => (<>{row.businessDate}<span className="block text-muted">{formatSiteStore(row.marketplaceId, row.sellerName)}</span></>),
    },
    {
      key: "sales",
      header: "销售额",
      numeric: true,
      render: (row) => row.metrics.orderedProductSales ? `${row.metrics.orderedProductSales.amount} ${row.metrics.orderedProductSales.currencyCode}` : "缺失",
    },
    { key: "units", header: "销量 / 订单商品数", render: (row) => `${row.metrics.unitsOrdered ?? "缺失"} / ${row.metrics.totalOrderItems ?? "缺失"}` },
    { key: "traffic", header: "Sessions / Page views", render: (row) => `${row.metrics.sessions ?? "缺失"} / ${row.metrics.pageViews ?? "缺失"}` },
    {
      key: "quality",
      header: "质量 / 数据版本",
      render: (row) => (<>{row.quality}<details><summary className="cursor-pointer text-brand">来源与版本</summary><p className="max-w-sm break-all">Reports 2021-06-30 · GET_SALES_AND_TRAFFIC_REPORT<br />报告 {row.reportId} · 文档 {row.documentId}<br />任务 / 版本 {row.syncRunId}<br />获取 {String(row.capturedAt)} · 发布 {String(row.publishedAt)}</p>{onTask && <Button size="sm" variant="secondary" onClick={() => onTask(row.syncRunId)}>查看来源任务</Button>}</details></>),
    },
  ];
  const matrixColumns: DataTableColumn<SalesMatrixDimension>[] = matrix ? [
    { key: "store", header: "店铺 / 站点", render: (row) => (<>{row.sellerName}<span className="block text-muted">{formatSiteStore(row.marketplaceId, row.sellerName)}</span></>) },
    ...matrix.dates.map(date => ({
      key: `date:${date}`, header: date,
      render: (row: SalesMatrixDimension) => cellValue(matrix.cells[row.key]?.[date], metric),
    })),
  ] : [];
  return <div className="space-y-4" data-testid="sales-traffic-workbench">
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="销量统计维度">
      <Button size="sm" variant={view === "products" ? "secondary" : "primary"} role="tab" aria-selected={view !== "products"} data-testid="dim-store" onClick={() => setView("rows")} title="店铺 × 业务日逐日汇总">店铺 × 业务日</Button>
      <Button size="sm" variant={view === "products" && productDim === "ASIN" ? "primary" : "secondary"} role="tab" aria-selected={view === "products" && productDim === "ASIN"} data-testid="dim-asin" onClick={() => { setProductDim("ASIN"); setView("products"); }} title="来自单日 CHILD 报告的 childAsin 商品日事实">ASIN<span className="ml-1 text-muted">· 商品日</span></Button>
      <Button size="sm" variant={view === "products" && productDim === "父ASIN" ? "primary" : "secondary"} role="tab" aria-selected={view === "products" && productDim === "父ASIN"} data-testid="dim-parent-asin" onClick={() => { setProductDim("父ASIN"); setView("products"); }} title="来自单日 CHILD 报告的 parentAsin 商品日事实">父ASIN<span className="ml-1 text-muted">· 商品日</span></Button>
      <Button size="sm" variant={view === "products" && productDim === "SKU" ? "primary" : "secondary"} role="tab" aria-selected={view === "products" && productDim === "SKU"} data-testid="dim-sku" onClick={() => { setProductDim("SKU"); setView("products"); }} title="来自单日 SKU 报告的 sellerSku 商品日事实（一个 ASIN 的多个 SKU 分行保存，不复制、不平均）">SKU<span className="ml-1 text-muted">· 商品日</span></Button>
      {PENDING_DIMENSIONS.map(d => <Button key={d} size="sm" variant="secondary" role="tab" aria-selected={false} aria-disabled disabled data-testid={`dim-pending-${d}`} title={`${d} 维度需要已验证的真实映射；当前不可用，不会用店铺日报、ASIN 或 SKU 数据拆分、平均、猜测替代。`}>{d}<span className="ml-1 text-muted">· 待验证</span></Button>)}
    </div>
    <p className="text-xs leading-relaxed text-muted">店铺维度为<strong>店铺 × 业务日</strong>汇总；ASIN / 父ASIN 维度来自<strong>单日 CHILD 报告</strong>、SKU 维度来自<strong>单日 SKU 报告</strong>的 <code>salesAndTrafficByAsin</code> 商品日事实（仅已闭合单日、不拆分多日汇总）。MSKU / SPU / 开发员 / 业务员需正式映射来源，在无来源时保持禁用，绝不拆分或平均店铺日报。</p>
    {!taskId && <form className="flex flex-wrap items-end gap-2 rounded border border-border p-3" onSubmit={e => { e.preventDefault(); void requestSync(); }}>
      <label className="grid gap-1 text-xs">同步来源<select aria-label="报告同步来源" className={input} value={source} onChange={e => setSource(e.target.value)} required><option value="">选择 Seller / Marketplace</option>{sources.filter(s => s.resource === "sales_traffic" && s.enabled).map(s => <option key={s.id} value={s.id}>{formatSiteStore(s.marketplaceId, s.seller.displayName || "未命名店铺")}</option>)}</select></label>
      <label className="grid gap-1 text-xs">同步日期<select aria-label="同步日期" className={input} value={preset} onChange={e => setPreset(e.target.value)}>{[["today", "今天"], ["yesterday", "昨天"], ["last7", "最近 7 天"], ["last30", "最近 30 天"], ["thisMonth", "本月"], ["lastMonth", "上月"], ["custom", "自定义"]].map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-xs">商品粒度<select aria-label="商品粒度" className={input} value={syncGranularity} onChange={e => setSyncGranularity(e.target.value as "CHILD" | "SKU")}><option value="CHILD">CHILD（子 ASIN，已验证）</option><option value="SKU">SKU（已验证）</option></select></label>
      {preset === "custom" && <><label className="grid gap-1 text-xs">同步开始日期<input type="date" className={input} value={syncFrom} onChange={e => setSyncFrom(e.target.value)} required /></label><label className="grid gap-1 text-xs">同步结束日期<input type="date" className={input} value={syncTo} onChange={e => setSyncTo(e.target.value)} required /></label></>}
      <Button type="submit" size="sm" disabled={!canSync || busy || !source}>申请报告同步</Button>
      <p className="w-full text-xs text-muted">每次最多 31 天、历史最多 730 天。商品日事实仅对<strong>单日已闭合</strong>窗口生成（多日 ASIN 汇总不会拆日）；选“昨天”或自定义单日可生成商品日。站点时区由后端确定；含今天的范围仅保留质量证据，不发布为完整数据。</p>
    </form>}
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs">Seller<select aria-label="日报 Seller" className={input} value={seller} onChange={e => select(setSeller, e.target.value)}><option value="">全部 Seller</option>{[...new Map(sources.filter(s => s.resource === "sales_traffic").map(s => [s.sellerAccountId, s.seller.displayName || "未命名店铺"])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="grid gap-1 text-xs">Marketplace<select aria-label="日报 Marketplace" className={input} value={site} onChange={e => select(setSite, e.target.value)}><option value="">全部 Marketplace</option>{[...new Set(sources.filter(s => s.resource === "sales_traffic").map(s => s.marketplaceId))].map(id => <option key={id} value={id}>{siteCodeForDisplay(id)}</option>)}</select></label>
      <label className="grid gap-1 text-xs">业务开始日期<input className={input} type="date" value={from} onChange={e => select(setFrom, e.target.value)} /></label><label className="grid gap-1 text-xs">业务结束日期<input className={input} type="date" value={to} onChange={e => select(setTo, e.target.value)} /></label>
      <label className="grid gap-1 text-xs">店铺 / Seller / 站点搜索<input className={input} value={keyword} maxLength={200} onChange={e => select(setKeyword, e.target.value)} /></label>
      {view === "products" && productDim === "SKU" && <label className="grid gap-1 text-xs">Seller SKU（精确）<input className={input} aria-label="Seller SKU（精确）" value={productKeyword} maxLength={100} onChange={e => { setProductKeyword(e.target.value); setPage(1); }} /></label>}
      <label className="grid gap-1 text-xs">业务日期排序<select aria-label="业务日期排序" className={input} value={direction} onChange={e => select(setDirection, e.target.value)}><option value="desc">最新在前</option><option value="asc">最早在前</option></select></label>
      <Button size="sm" variant="secondary" disabled={loading || busy} onClick={() => setReload(v => v + 1)}>刷新</Button><Button size="sm" disabled={!canExport || busy || loading || !result && !matrix && !productResult} onClick={() => void exportData()}>按当前条件异步导出</Button>
    </div>
    <div className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs">
      <span className="text-muted">视图</span>
      <Button size="sm" variant={view === "rows" ? "primary" : "secondary"} onClick={() => setView("rows")} data-testid="view-rows">店铺逐日</Button>
      <Button size="sm" variant={view === "matrix" ? "primary" : "secondary"} onClick={() => setView("matrix")} data-testid="view-matrix">店铺 × 日矩阵</Button>
      <Button size="sm" variant={view === "products" ? "primary" : "secondary"} onClick={() => setView("products")} data-testid="view-products">商品日</Button>
      <span className="ml-2 text-muted">指标</span>
      {METRICS.map(m => <Button key={m.key} size="sm" variant={metric === m.key ? "primary" : "secondary"} onClick={() => setMetric(m.key)} data-testid={`metric-${m.key}`}>{m.label}</Button>)}
    </div>
    {error && errorCode && <ReadinessNotice kind={readinessKindFromCode(errorCode)} detail={error} />}
    {error && !errorCode && <p role="alert" className="text-sm text-danger-ink">{error}</p>}{notice && <p role="status" className="text-sm text-brand">{notice}</p>}
    {job && <p className="text-xs">导出 {job.id} · {job.status} · {job.rowCount ?? "—"} 条 {job.error}{job.status === "SUCCEEDED" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void download()}>下载 JSONL（含来源与版本）</Button>}</p>}
    {loading && <p role="status">读取已发布日报…</p>}
    {view === "rows" && result && <><StandardDataTable
        ariaLabel="销售流量日报"
        rows={result.rows}
        getRowKey={(row) => row.id}
        columns={salesColumns}
        empty="没有符合条件的成功发布日报；这不代表销量为 0。"
      /><div className="flex items-center justify-end gap-3 text-xs"><span>{result.pagination.total} 条 · {page} / {Math.max(1, result.pagination.pageCount)}</span><Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(v => v - 1)}>日报上一页</Button><Button size="sm" variant="secondary" disabled={page >= result.pagination.pageCount || loading} onClick={() => setPage(v => v + 1)}>日报下一页</Button></div></>}
    {view === "matrix" && matrix && <>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted" data-testid="matrix-coverage">
        <span>粒度：{matrix.granularity}（店铺 × 业务日汇总，非商品日）</span>
        <span>覆盖：{matrix.coverage.coveredStoreDays} / {matrix.coverage.storeDays} 店铺日 · {matrix.coverage.days} 个业务日</span>
        <span>发布时刻 asOf：{matrix.asOf}</span>
        {matrix.truncated && <span className="text-warning-ink">矩阵已达 5,000 行上限，请缩小日期或店铺范围。</span>}
      </div>
      <StandardDataTable
        ariaLabel="店铺业务日矩阵"
        rows={matrix.dimensions}
        getRowKey={(row) => row.key}
        columns={matrixColumns}
        empty="没有符合条件的已发布店铺日数据；“—”表示缺失，不代表 0。"
      />
      <p className="text-xs text-muted">“—”表示该店铺该业务日没有完整发布数据，不作为 0 处理；数值 0 仅代表已确认的完整空结果。矩阵仅重排已发布的真实店铺日行，不新增、不拆分、不平均任何数据。</p>
    </>}
    {view === "products" && productResult && <>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted" data-testid="product-coverage">
        <span>数据粒度：商品日（{productResult.granularity === "SKU" ? "SKU" : "子 ASIN CHILD"}）</span>
        <span>共 {productResult.pagination.total} 条 · 单日已闭合事实</span>
        <span>发布时刻 asOf：{productResult.asOf}</span>
      </div>
      {productDim === "父ASIN" && <p className="text-xs text-muted">每行显示其报告的 <code>parentAsin</code>（缺失显示“—”）；当前按商品行展示，<strong>未按父体合并销量</strong>——父子体合并口径需先与源站对账，在此之前不编造父体小计、不用子 ASIN 冒充父体。</p>}
      {productDim === "SKU" && <p className="text-xs text-muted">每行是单日 SKU 报告的 <code>sellerSku</code> 商品日事实；<strong>一个 ASIN 的多个 SKU 分行保存各自销量，不复制、不把 ASIN 销量摊给 SKU</strong>。SKU 身份来自真实报告，不按库存或 Listing 猜测。</p>}
      <StandardDataTable
        ariaLabel="商品日销量"
        rows={productResult.rows}
        getRowKey={(row) => row.id}
        columns={[
          { key: "asin", header: "商品身份", render: (row) => (<>{productDim === "SKU" ? (row.sellerSku ?? "—") : productDim === "父ASIN" ? (row.parentAsin ?? "—") : row.childAsin}<span className="block text-muted">{formatSiteStore(row.marketplaceId, row.sellerName)}{productDim !== "SKU" && row.sellerSku ? ` · ${row.sellerSku}` : ""}{productDim === "SKU" && row.childAsin ? ` · ASIN ${row.childAsin}` : ""}</span></>) },
          { key: "date", header: "业务日", render: (row) => row.businessDate },
          { key: "sales", header: "销售额", numeric: true, render: (row) => row.metrics.orderedProductSales ? `${row.metrics.orderedProductSales.amount} ${row.metrics.orderedProductSales.currencyCode}` : "—" },
          { key: "units", header: "销量 / 订单商品项数", render: (row) => `${row.metrics.unitsOrdered ?? "—"} / ${row.metrics.totalOrderItems ?? "—"}` },
          { key: "traffic", header: "Sessions / Page views", render: (row) => `${row.metrics.sessions ?? "—"} / ${row.metrics.pageViews ?? "—"}` },
          { key: "quality", header: "质量 / 版本", render: (row) => (<>{row.quality}<details><summary className="cursor-pointer text-brand">来源与版本</summary><p className="max-w-sm break-all">Reports 2021-06-30 · GET_SALES_AND_TRAFFIC_REPORT<br />报告 {row.reportId} · 文档 {row.documentId}<br />任务 / 版本 {row.syncRunId}<br />获取 {String(row.capturedAt)} · 发布 {String(row.publishedAt)}</p>{onTask && <Button size="sm" variant="secondary" onClick={() => onTask(row.syncRunId)}>查看来源任务</Button>}</details></>) },
        ] as DataTableColumn<ProductSalesRow>[]}
        empty="没有符合条件的已发布商品日事实；请确认已对单日申请过商品报告同步。这不代表销量为 0。"
      />
      <div className="flex items-center justify-end gap-3 text-xs"><span>{productResult.pagination.total} 条 · {page} / {Math.max(1, productResult.pagination.pageCount)}</span><Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(v => v - 1)}>上一页</Button><Button size="sm" variant="secondary" disabled={page >= productResult.pagination.pageCount || loading} onClick={() => setPage(v => v + 1)}>下一页</Button></div>
      <p className="text-xs text-muted">商品日事实来自单日 CHILD/SKU 报告的 <code>salesAndTrafficByAsin</code>；一个 ASIN 的销量不会拆分或摊给多个 SKU。订单商品项数不等于去重订单数；缺失显示“—”，不补零。</p>
    </>}
    <details className="rounded border border-border p-3 text-xs" data-testid="metric-definitions">
      <summary className="cursor-pointer text-brand">指标口径与数据边界说明</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        <li><strong>销量</strong>：报告 <code>unitsOrdered</code>；<strong>销售额</strong>：报告 <code>orderedProductSales</code>（订单商品销售额，不等于净销售额或利润）；<strong>Sessions / Page views</strong> 为报告流量字段。</li>
        <li><strong>订单商品项数</strong>（<code>totalOrderItems</code>）≠ 按订单 ID 去重的「订单数」。当前没有可去重的订单级来源，系统不把订单商品项数冒充订单数。</li>
        <li>库存：<strong>FBA 库存</strong>是按店铺 / 站点 / SKU 保存的采集<strong>时点快照</strong>，反映当前可售、预留、不可售和入库状态，<strong>不是历史每日库存</strong>，也不能当作某业务日的销量；查看当前库存请到 <a className="text-brand" href="/amazon/inventory">/amazon/inventory</a>。</li>
        <li>业务日为 Marketplace 报告业务日（含结束日）；每日选择最新成功且完整的发布版本；缺失日期显示“—”，不补零。</li>
      </ul>
    </details>
  </div>;
}
