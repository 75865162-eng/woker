"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WmsReceiptDetails } from "./wms-receipt-details";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";

type Receipt = { id: string; number: string; status: string; lines: Array<{ expectedQty: number; receivedQty: number; acceptedQty: number; rejectedQty: number; putawayQty: number }> };
const labels: Record<string, string> = { DRAFT: "待收货", RECEIVED: "待质检", INSPECTED: "待上架", PUTAWAY: "已完成上架", CANCELLED: "已取消" };

/** Reads the same permission-checked WMS query used by the warehouse page. */
export function PurchaseReceiptProgress({ ids, workspaceId, sourceReference }: { ids: string[]; workspaceId: string; sourceReference: string }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = receipts.find(receipt => receipt.id === selectedId);
  const key = JSON.stringify(ids);
  useEffect(() => {
    const controller = new AbortController();
    setReceipts([]); setError(""); setLoading(true);
    void (async () => {
      const selected: string[] = JSON.parse(key);
      const result: Receipt[] = [];
      for (const id of selected) {
        const params = new URLSearchParams({ id, limit: "1" });
        const response = await fetch(`/api/operations/wms/receipts?${params}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(response.status === 403 ? "当前账号没有仓库读取权限。" : data.error || "收货进度读取失败。");
        if (data.items?.length !== 1 || data.items[0].id !== id) throw new Error("关联收货单当前不可读取，请在仓库核对。");
        result.push(data.items[0]);
      }
      if (!controller.signal.aborted) setReceipts(result);
    })().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "收货进度读取失败。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [key, workspaceId, attempt]);
  return <section aria-label="采购收货进度" className="space-y-3 rounded border border-border p-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">实际收货进度</h3><Button type="button" size="sm" variant="secondary" disabled={loading} onClick={() => setAttempt(value => value + 1)}>刷新收货进度</Button></div>
    {loading && <p role="status" className="text-sm text-muted">正在读取仓库收货进度…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!loading && !error && !receipts.length && <p className="text-sm text-muted">尚未创建收货单。</p>}
    {receipts.map(receipt => <div key={receipt.id} className="space-y-2 border-t border-border pt-3">
      <p className="text-sm font-medium">{receipt.number} · {labels[receipt.status] ?? receipt.status}</p>
      {/* Wimoor purchase/orders/components/arrival_record.vue: per-receipt card → details.
          Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt. */}
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{([["expectedQty", "本批计划"], ["receivedQty", "本批实收"], ["rejectedQty", "本批拒收"], ["putawayQty", "本批上架"]] as const).map(([key, label]) => <div key={key}><dt className="text-muted">{label}</dt><dd className="mt-1 font-medium">{receipt.lines.length && receipt.lines.every(line => Number.isSafeInteger(line[key]) && line[key] >= 0) ? receipt.lines.reduce((sum, line) => sum + line[key], 0) : "未读取"}</dd></div>)}</dl>
      {(() => {
        const shortQty = receipt.lines.reduce((sum, line) => sum + Math.max(0, line.expectedQty - line.receivedQty), 0);
        const rejectedQty = receipt.lines.reduce((sum, line) => sum + line.rejectedQty, 0);
        const exceptionState = ["RECEIVED", "INSPECTED", "PUTAWAY"].includes(receipt.status);
        return exceptionState && (shortQty || rejectedQty) ? <div role="status" className="space-y-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"><p>收货异常：短收 {shortQty} · 拒收 {rejectedQty}。可在仓库收货单中核对明细并继续处理。</p><div className="flex gap-3">{shortQty > 0 && <a className="font-medium text-brand hover:underline" href={`/logistics/warehouse?tab=receipts&sourceReference=${encodeURIComponent(sourceReference)}&workflowStatus=SHORT_RECEIVED`}>查看短收单据</a>}{rejectedQty > 0 && <a className="font-medium text-brand hover:underline" href={`/logistics/warehouse?tab=receipts&sourceReference=${encodeURIComponent(sourceReference)}&workflowStatus=HAS_REJECTED`}>查看拒收单据</a>}</div></div> : null;
      })()}
      <WmsReceiptDetails receipt={receipt} />
      <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedId(receipt.id)}>到货记录详情</Button>
      <a className="inline-block text-sm text-brand hover:underline" href={`/logistics/warehouse?tab=receipts&receiptId=${encodeURIComponent(receipt.id)}`}>处理此收货单</a>
    </div>)}
    <p className="text-xs text-muted">进度来自 WMS 当前记录；实收、合格、拒收与已上架分别显示，不把待检或待上架当作可用库存。</p>
    <WorkbenchDialog open={!!selected} title="采购到货记录详情" drawer onClose={() => setSelectedId(null)}>{selected && <div className="space-y-4"><dl className="grid gap-3 text-sm sm:grid-cols-2">{[["采购来源单号", sourceReference], ["收货单号", selected.number], ["收货单 ID", selected.id], ["当前状态", labels[selected.status] ?? selected.status]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}</dl><WmsReceiptDetails receipt={selected} /><a className="inline-block text-sm text-brand hover:underline" href={`/logistics/warehouse?tab=receipts&receiptId=${encodeURIComponent(selected.id)}`}>在仓库处理此收货单</a><p className="text-xs text-muted">此处读取当前收货单，不代替不可变库存流水；不提供直接撤销入库或删除记录的操作。</p></div>}</WorkbenchDialog>
  </section>;
}
