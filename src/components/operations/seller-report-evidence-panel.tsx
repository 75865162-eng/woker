"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
type Evidence = { archiveCollection?: { status?: string; lastCompletedAt?: string; from?: string; to?: string; rows?: number } | null; documents: Array<{ id: string; reportId: string; rowCount: number; capturedAt: string; sourceRunId: string }>; selectedDocumentId?: string; rows: Array<{ rowNumber: number; businessDate: string | null; orderId: string | null; sellerSku: string | null; asin: string | null; transactionType: string | null; amountOriginal: string | null; currencyCode: string | null; quantityOriginal: string | null }>; pagination: { total: number; pageCount: number }; duplicateReports: number };
export function SellerReportEvidencePanel({ resource, sourceId, getHeaders, onTask }: { resource: string; sourceId: string; getHeaders: () => Headers; onTask: (id: string) => void }) {
  const [open, setOpen] = useState(false), [documentId, setDocumentId] = useState(""), [page, setPage] = useState(1), [result, setResult] = useState<Evidence | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setResult(null);
    const params = new URLSearchParams({ section: "seller-report-evidence", resource, sourceId, documentId, page: String(page) });
    void fetch(`/api/operations/sync-center?${params}`, { headers: getHeaders(), cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "卖家级证据读取失败。");
      if (!controller.signal.aborted) setResult(data);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "证据读取失败。"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, resource, sourceId, documentId, page, getHeaders]);
  return <section className="space-y-3 rounded border border-amber-300 p-3">
    <Button variant="secondary" size="sm" onClick={() => setOpen(v => !v)}>{open ? "收起" : "查看"}管理员卖家级报告证据</Button>
    {open && <><p role="status" className="text-xs text-amber-700">已采集原件 · 卖家级 / 销售站点待核验。仅管理员可见；不计入任何店铺库存、金额或同步成功，普通店铺查询继续隔离。</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{loading && <p role="status" className="text-xs">校验原件并读取安全字段…</p>}
      {result && <>{result.archiveCollection && <p className="text-xs text-amber-700">卖家归档完成：{result.archiveCollection.lastCompletedAt ?? "—"} · {result.archiveCollection.from} 至 {result.archiveCollection.to} · {result.archiveCollection.rows} 行；店铺事实未发布。</p>}<label className="flex flex-wrap items-center gap-2 text-xs">内容去重报告<select className="min-h-9 rounded border border-border bg-background px-2" value={documentId || result.selectedDocumentId || ""} onChange={e => { setDocumentId(e.target.value); setPage(1); }}>{result.documents.map(d => <option key={d.id} value={d.id}>{d.reportId} · {d.rowCount} 行 · {new Date(d.capturedAt).toISOString()}</option>)}</select><span>已合并 {result.duplicateReports} 份相同内容报告</span></label>
        {!result.documents.length && <p className="text-xs">尚无已归档原件。</p>}
        <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead><tr>{["原件行", "业务日期", "订单", "SKU / ASIN", "事件类型", "金额原值 / 币种", "数量原值"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead><tbody>{result.rows.map(row => <tr key={row.rowNumber} className="border-t border-border"><td className="py-2">{row.rowNumber}</td><td>{row.businessDate ?? "—"}</td><td>{row.orderId ?? "—"}</td><td>{row.sellerSku ?? "—"} / {row.asin ?? "—"}</td><td>{row.transactionType ?? "—"}</td><td>{row.amountOriginal ?? "—"} {row.currencyCode ?? ""}</td><td>{row.quantityOriginal ?? "—"}</td></tr>)}</tbody></table></div>
        <div className="flex flex-wrap items-center justify-end gap-3 text-xs"><span>当前原件 {result.pagination.total} 行 · 第 {page} / {Math.max(1, result.pagination.pageCount)} 页</span><Button size="sm" variant="secondary" disabled={loading || page <= 1} onClick={() => setPage(v => v - 1)}>上一页</Button><Button size="sm" variant="secondary" disabled={loading || page >= result.pagination.pageCount} onClick={() => setPage(v => v + 1)}>下一页</Button>{result.documents.find(d => d.id === result.selectedDocumentId) && <Button size="sm" variant="secondary" onClick={() => onTask(result.documents.find(d => d.id === result.selectedDocumentId)!.sourceRunId)}>查看采集任务</Button>}</div>
      </>}
    </>}
  </section>;
}
