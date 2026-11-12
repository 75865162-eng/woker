"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";
import { BusinessRecordFields } from "./business-record-fields";
type Row = { id: string; sourceRunId: string; kind: string; asin: string | null; sellerSku: string | null; searchTerm: string | null; facts: Record<string, unknown>; capturedAt: string };
type Result = { run?: { id: string; finishedAt: string; summary?: { coverage?: { complete?: boolean; unavailableObjectIds?: string[] } } } | null; latestTask?: { id: string; status: string; stage: string; processedCount: number; failedCount: number; updatedAt: string; error: string | null } | null; sources: Array<{ id: string; marketplaceId: string; seller: { displayName: string } }>; source: { id: string; lastSuccessAt: string | null } | null; versions: Array<{ id: string; finishedAt: string; summary?: { coverage?: { reportKind?: string; from?: string; to?: string } } }>; rows: Row[]; pagination: { total: number; pageCount: number } };
const input = "min-h-9 rounded border border-border bg-background px-2 text-xs";
const kinds: Record<string, Array<[string, string]>> = { listing_details: [["LISTING_DETAIL", "完整 Listing"]], catalog_items: [["CATALOG_DETAIL", "商品目录"]], fulfillment: [["INBOUND_PLAN", "入库计划"], ["INBOUND_SHIPMENT", "货件状态"], ["INBOUND_PLAN_ITEM", "计划商品"], ["INBOUND_SHIPMENT_ITEM", "货件商品"]], pricing: [["OWN_PRICE_ASIN", "自有商品价格"], ["COMPETITIVE_PRICE", "价格与 Featured Offer"]], brand_analytics: [["BRAND_SEARCH_TERMS", "搜索词分析"], ["BRAND_SEARCH_QUERY", "搜索查询绩效"], ["BRAND_SEARCH_CATALOG", "搜索目录绩效"], ["BRAND_MARKET_BASKET", "购买组合"]], buy_box_history: [["BUY_BOX_DAY", "历史日报"]] };
const text = (value: unknown) => value === undefined || value === null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
const fulfillmentStatusStyles: Record<string, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  WORKING: "border-amber-200 bg-amber-50 text-amber-800",
  SHIPPED: "border-sky-200 bg-sky-50 text-sky-800",
  IN_TRANSIT: "border-sky-200 bg-sky-50 text-sky-800",
  DELIVERED: "border-blue-200 bg-blue-50 text-blue-800",
  CHECKED_IN: "border-indigo-200 bg-indigo-50 text-indigo-800",
  RECEIVING: "border-amber-200 bg-amber-50 text-amber-800",
  CLOSED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-700",
  DELETED: "border-slate-200 bg-slate-50 text-slate-700",
  ERROR: "border-red-200 bg-red-50 text-red-800",
};
function cells(row: Row): string[] {
  const f = row.facts;
  if (row.kind === "LISTING_DETAIL" || row.kind === "CATALOG_DETAIL") { const summary = (f.summaries as Array<Record<string, unknown>> | undefined)?.[0] ?? {}; const attrs = f.attributes as Record<string, unknown> | null; return [text(row.sellerSku ?? row.asin), text(summary.itemName), text(summary.brand ?? summary.productType ?? summary.itemClassification), text(attrs?.bullet_point ?? attrs?.product_description ?? attrs?.model_number), text(f.relationships)]; }
  if (row.kind === "INBOUND_PLAN") return [text(f.inboundPlanId), text(f.name), text(f.sourceStatus), text(f.sourceCreatedAt), text(f.sourceUpdatedAt)];
  if (row.kind === "INBOUND_SHIPMENT") return [text(f.shipmentId), text(f.name), text(f.sourceStatus), text(f.destinationWarehouseId), text(f.inboundPlanId)];
  if (row.kind.startsWith("INBOUND_")) return [text(f.sellerSku), text(f.asin), text(f.fnsku), text(f.declaredQuantity), text(f.quantitySemantics)];
  if (row.kind === "OWN_PRICE_ASIN") return [text(f.asin), text(f.marketplaceId), text(f.offers), "New / B2C", text(f.availability)];
  if (row.kind === "COMPETITIVE_PRICE") return [text(f.asin), text(f.marketplaceId), text(f.featuredBuyingOptions), text(f.referencePrices), "分段赢家；自有报价见自有价格视图"];
  if (row.kind === "BUY_BOX_DAY") return [text(f.businessDate), text(f.asin), f.buyBoxPercentage == null ? "未知" : `${f.buyBoxPercentage}%`, text(f.sessions), text(f.pageViews)];
  return [text(f.from), text(f.to), text(f.searchTerm ?? row.asin), text(f.searchFrequencyRank ?? f.searchQueryData ?? f.purchasedWithAsin), text(f.clickShare ?? f.purchaseData ?? f.combinationPct)];
}
export function ObservationsWorkbench({ resource, sellerAccountId, marketplaceId, getHeaders, onTask, onSync }: { resource: string; sellerAccountId: string; marketplaceId: string; getHeaders: () => Headers; onTask: (id: string) => void; onSync?: (sourceId: string) => void }) {
  const [kind, setKind] = useState(kinds[resource][0][0]), [sourceId, setSourceId] = useState(""), [runId, setRunId] = useState(""), [asin, setAsin] = useState(""), [sku, setSku] = useState(""), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [inboundPlanId, setInboundPlanId] = useState(""), [shipmentId, setShipmentId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setResult(null); setSelectedId(null); setLoading(true); setError("");
    const params = new URLSearchParams({ section: "observations", resource, sellerAccountId, marketplaceId, sourceId, runId, asin, sellerSku: sku, kind, ...(resource === "fulfillment" ? { inboundPlanId, shipmentId } : {}), page: String(page) });
    void fetch(`/api/operations/sync-center?${params}`, { headers: getHeaders(), cache: "no-store", signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "观察记录读取失败。"); if (!controller.signal.aborted) setResult(data); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "读取失败。"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [resource, sellerAccountId, marketplaceId, sourceId, runId, asin, sku, kind, inboundPlanId, shipmentId, page, refresh, getHeaders]);
  const selected = result?.rows.find(row => row.id === selectedId);
  function drill(row: Row, nextKind: string) {
    setInboundPlanId(typeof row.facts.inboundPlanId === "string" ? row.facts.inboundPlanId : "");
    setShipmentId(nextKind === "INBOUND_SHIPMENT_ITEM" && typeof row.facts.shipmentId === "string" ? row.facts.shipmentId : "");
    setAsin(""); setSku(""); setKind(nextKind); setPage(1); setSelectedId(null);
  }
  function rowActions(row: Row, includeDetail = true) {
    return <div className="flex flex-wrap gap-2">{includeDetail && <Button size="sm" variant="secondary" onClick={() => setSelectedId(row.id)}>查看详情</Button>}{row.kind === "INBOUND_PLAN" && typeof row.facts.inboundPlanId === "string" && <><Button size="sm" variant="secondary" onClick={() => drill(row, "INBOUND_SHIPMENT")}>查看货件</Button><Button size="sm" variant="secondary" onClick={() => drill(row, "INBOUND_PLAN_ITEM")}>计划商品</Button></>}{row.kind === "INBOUND_SHIPMENT" && typeof row.facts.shipmentId === "string" && <Button size="sm" variant="secondary" onClick={() => drill(row, "INBOUND_SHIPMENT_ITEM")}>货件商品</Button>}</div>;
  }
  const titles = ["listing_details", "catalog_items"].includes(resource) ? ["SKU / ASIN", "标题", "品牌 / 商品类型", "要点 / 属性", "变体关系"] : resource === "fulfillment" ? kind === "INBOUND_PLAN" ? ["入库计划", "计划名称", "Amazon 状态", "创建时间", "更新时间"] : kind === "INBOUND_SHIPMENT" ? ["货件", "货件名称", "Amazon 状态", "目的仓", "所属计划"] : ["SKU", "ASIN", "FNSKU", "申报数量", "数量口径"] : resource === "pricing" ? ["ASIN", "站点", "报价 / 分段 Featured Offer", "类型 / 参考价格", "覆盖"] : resource === "buy_box_history" ? ["业务日", "ASIN", "Buy Box 比例", "Sessions", "Page Views"] : ["周期起", "周期止", "搜索词 / ASIN", "排名 / 查询 / 组合 ASIN", "份额 / 购买表现"];
  return <div className="space-y-3" data-testid={`amazon-${resource}-observations`}>
    <p className="text-xs text-muted">{resource === "listing_details" || resource === "catalog_items" ? "Listing 与目录是按审批 SKU/ASIN 保存的 Amazon 外部观察，不覆盖 ProductRecord；已保存业务属性完整返回，过滤凭证秘密；图片保留 URL/尺寸元数据。" : resource === "fulfillment" ? "仅展示审批计划范围。申报数量不等于已发货、已接收或实际在途数量，未返回的运输事件保持未知。" : resource === "pricing" ? "自有价格固定为 New / B2C；Featured Offer 按购买选项与会员分段展示；未返回的自有报价不填零，不合并为全站唯一赢家。" : resource === "buy_box_history" ? "每个版本来自单个已闭合业务日的 ASIN 报告，百分比为 0–100；空值表示未返回。" : "品牌分析需品牌资格。搜索频率排名不是搜索量；点击、购买与组合份额为 0–1，报告周期分别保存。"}</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label="分析视图">{kinds[resource].map(([id, label]) => <Button key={id} size="sm" aria-pressed={kind === id} variant={kind === id ? "primary" : "secondary"} onClick={() => { setKind(id); setPage(1); }}>{label}</Button>)}</div>
    {resource === "fulfillment" && <div className="flex flex-wrap gap-2"><label className="grid gap-1 text-xs">入库计划 ID<input className={input} value={inboundPlanId} maxLength={200} onChange={e => { setInboundPlanId(e.target.value); setPage(1); }} /></label><label className="grid gap-1 text-xs">货件 ID<input className={input} value={shipmentId} maxLength={200} onChange={e => { setShipmentId(e.target.value); setPage(1); }} /></label></div>}
    <div className="flex flex-wrap gap-2"><label className="grid gap-1 text-xs">店铺 / 站点<select className={input} value={sourceId || result?.source?.id || ""} onChange={e => { setSourceId(e.target.value); setRunId(""); setPage(1); }}><option value="">首个可访问来源</option>{result?.sources.map(s => <option key={s.id} value={s.id}>{s.seller.displayName} / {s.marketplaceId}</option>)}</select></label><label className="grid gap-1 text-xs">观察版本<select className={input} value={runId} onChange={e => { setRunId(e.target.value); setPage(1); }}><option value="">最新已发布</option>{result?.versions.map(v => <option key={v.id} value={v.id}>{v.summary?.coverage?.reportKind ?? resource} {v.summary?.coverage?.from ?? ""} / {new Date(v.finishedAt).toLocaleString()} / {v.id.slice(0, 8)}</option>)}</select></label><label className="grid gap-1 text-xs">ASIN<input className={input} value={asin} onChange={e => { setAsin(e.target.value); setPage(1); }} /></label>{["fulfillment", "listing_details"].includes(resource) && <label className="grid gap-1 text-xs">SKU<input className={input} value={sku} onChange={e => { setSku(e.target.value); setPage(1); }} /></label>}<Button size="sm" variant="secondary" disabled={loading} onClick={() => { setAsin(""); setSku(""); setRunId(""); setInboundPlanId(""); setShipmentId(""); setPage(1); }}>重置筛选</Button><Button size="sm" variant="secondary" disabled={loading} onClick={() => setRefresh(v => v + 1)}>刷新列表</Button>{onSync && result?.source && <Button size="sm" onClick={() => onSync(result.source!.id)}>申请采集当前来源</Button>}</div>
    {resource === "fulfillment" && (inboundPlanId || shipmentId) && <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface p-3 text-xs" aria-label="当前货件范围"><span>计划：{inboundPlanId || "全部"} · 货件：{shipmentId || "全部"}</span><Button size="sm" variant="secondary" onClick={() => { setInboundPlanId(""); setShipmentId(""); setAsin(""); setSku(""); setKind("INBOUND_PLAN"); setPage(1); }}>返回全部计划</Button></div>}
    {result?.run?.summary?.coverage?.complete === false && <p role="status" className="rounded border border-border p-3 text-xs">当前为已批准的部分发布，尚未取得的目录对象：{result.run.summary.coverage.unavailableObjectIds?.join("、") ?? "请查看来源任务"}。这些缺口不代表商品已删除，当前版本不代表全量目录。</p>}
    {result?.latestTask && <div role="status" className="space-y-1 rounded border border-border p-3 text-xs text-muted"><p>最近采集：{result.latestTask.status} / {result.latestTask.stage} · 已处理 {result.latestTask.processedCount} 个对象 · 失败 {result.latestTask.failedCount} 个</p><p>任务更新时间：{new Date(result.latestTask.updatedAt).toLocaleString()}；采集中结果完成后统一发布。</p>{result.latestTask.error && <p className="text-red-700">{result.latestTask.error}</p>}<Button size="sm" variant="secondary" onClick={() => onTask(result.latestTask!.id)}>查看采集进度</Button></div>}
    {loading && <p role="status">读取已发布观察记录…</p>}{error && <p role="alert" className="text-red-700">{error}</p>}
    {result && <>{result.run && <p className="break-all text-xs text-muted">当前已发布版本：{result.run.id} · {new Date(result.run.finishedAt).toLocaleString()}</p>}<div className="overflow-x-auto rounded border border-border"><table aria-label="已发布观察记录" className="w-full min-w-[800px] text-left text-xs"><thead className="bg-surface-muted"><tr>{[...titles, "采集时间 / 来源", "操作"].map(title => <th className="px-3 py-2 font-medium" key={title}>{title}</th>)}</tr></thead><tbody>{result.rows.map(row => <tr key={row.id} className="border-t border-border">{cells(row).map((v, i) => {
        const isFulfillmentStatus = resource === "fulfillment" && ["INBOUND_PLAN", "INBOUND_SHIPMENT"].includes(row.kind) && i === 2;
        return <td key={i} className="max-w-[260px] px-3 py-2">{isFulfillmentStatus ? <span data-amazon-status={v} className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${fulfillmentStatusStyles[v] ?? "border-border bg-surface-muted text-muted"}`}>{v}</span> : <span className="line-clamp-2 break-words" title={v}>{v}</span>}</td>;
      })}<td><span>{new Date(row.capturedAt).toLocaleString()}</span><Button size="sm" variant="secondary" onClick={() => onTask(row.sourceRunId)}>来源任务</Button><details><summary>完整业务字段</summary><pre className="max-w-[400px] overflow-auto whitespace-pre-wrap">{JSON.stringify(row.facts, null, 2)}</pre></details></td><td className="min-w-[140px] py-2">{rowActions(row)}</td></tr>)}</tbody></table></div>{!result.rows.length && <p className="py-5 text-center text-muted">{result.run ? "当前已发布版本没有符合筛选条件的记录，请调整视图或筛选条件。" : result.latestTask ? "当前来源尚无完整发布版本，请查看采集进度或错误；无需重复提供商品清单。" : "暂无已发布数据。绑定对应数据源并完成审批任务后显示；未完成任务不覆盖当前版本。"}</p>}<div className="flex items-center justify-end gap-3 text-xs"><span>{result.pagination.total} 条 · 第 {page} 页</span><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>上一页</Button><Button size="sm" variant="secondary" disabled={page >= result.pagination.pageCount} onClick={() => setPage(v => v + 1)}>下一页</Button></div></>}
    <WorkbenchDialog open={!!selected} drawer title={resource === "fulfillment" ? "FBA 观察详情" : "商品与业务观察详情"} onClose={() => setSelectedId(null)}>{selected && <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 rounded border border-border p-3 text-xs">{[["记录类型", kinds[resource].find(([id]) => id === selected.kind)?.[1] ?? selected.kind], ["SKU", selected.sellerSku], ["ASIN", selected.asin], ["采集时间", new Date(selected.capturedAt).toLocaleString()], ["来源版本", selected.sourceRunId]].map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 break-all">{value ?? "—"}</dd></div>)}</dl>
      {resource === "fulfillment" && <><p className="text-xs text-muted">Amazon 外部观察；申报数量不代表已发货、接收或实际在途。在线创建、确认装箱和发货尚未接入。</p>{rowActions(selected, false)}</>}
      <Button size="sm" variant="secondary" onClick={() => onTask(selected.sourceRunId)}>查看来源任务</Button>
      <BusinessRecordFields key={selected.id} fields={selected.facts} />
    </div>}</WorkbenchDialog>
  </div>;
}
