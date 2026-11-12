import { receiptActionRemaining } from "@/lib/wms/receipt-action-view";

import { WmsReceiptLot } from "./wms-receipt-lot";
import type { ReceiptLotContext, ReceiptLocationContext } from "@/lib/wms/receipt-view";

const fields = [["expectedQty", "计划"], ["receivedQty", "实收"], ["acceptedQty", "合格"], ["rejectedQty", "拒收"], ["returnedQty", "已退回"], ["putawayQty", "已上架"]] as const;
export function WmsReceiptDetails({ receipt }: { receipt: Record<string, unknown> }) {
  const lines = Array.isArray(receipt.lines) ? receipt.lines as Record<string, unknown>[] : [];
  const location = receipt.receivingLocation as ReceiptLocationContext | null | undefined;
  return <details className="min-w-64 whitespace-normal text-sm">
    <summary className="cursor-pointer">查看收货明细</summary>
    <div className="my-2 break-all"><p>仓库：{location ? `${location.warehouseCode} · ${location.warehouseName}` : "当前资料不可用"}</p><p>收货库位：{location?.locationCode ?? "当前资料不可用"}</p><p className="text-xs text-muted-foreground">库位 ID：{String(receipt.receivingLocationId ?? "未读取")}</p></div>
    {lines.length ? <table aria-label="收货批次数量" className="w-full border-collapse text-right">
      <thead><tr><th className="p-2 text-left">批次与条码</th>{fields.map(([key, label]) => <th key={key} className="p-2">{label}</th>)}<th className="p-2">短收差异</th><th className="p-2">待质检</th><th className="p-2">待上架</th></tr></thead>
      <tbody>{lines.map(line => {
        const valid = fields.every(([key]) => typeof line[key] === "number" && Number.isSafeInteger(line[key]) && (line[key] as number) >= 0);
        const pendingQc = valid ? receiptActionRemaining(line, "INSPECT") : NaN;
        const pendingPutaway = valid ? receiptActionRemaining(line, "PUTAWAY") : NaN;
        return <tr key={String(line.id)} data-receipt-line={String(line.id)} className="border-t border-border">
          <td className="break-all p-2 text-left"><WmsReceiptLot lotId={String(line.lotId ?? "未读取")} lot={line.lot as ReceiptLotContext | null} /></td>
          {fields.map(([key]) => <td key={key} data-quantity={key} className="p-2">{typeof line[key] === "number" ? String(line[key]) : "未读取"}</td>)}
          <td data-quantity="shortage" className="p-2">{!valid ? "需刷新" : ["DRAFT", "CANCELLED"].includes(String(receipt.status)) ? "—" : Math.max(0, Number(line.expectedQty) - Number(line.receivedQty))}</td>
          <td data-quantity="pendingQc" className="p-2">{Number.isSafeInteger(pendingQc) && pendingQc >= 0 ? pendingQc : "需刷新"}</td>
          <td data-quantity="pendingPutaway" className="p-2">{Number.isSafeInteger(pendingPutaway) && pendingPutaway >= 0 ? pendingPutaway : "需刷新"}</td>
        </tr>;
      })}</tbody>
    </table> : <p className="my-2">明细尚未读取，请刷新收货单。</p>}
  </details>;
}
