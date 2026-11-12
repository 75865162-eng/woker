import type { ReceiptLotContext } from "@/lib/wms/receipt-view";

export function WmsReceiptLot({ lotId, lot }: { lotId: string; lot?: ReceiptLotContext | null }) {
  return <div className="break-all text-left"><p>批次：{lot?.lotCode ?? "当前资料不可用"}</p><p>条码：{lot ? lot.barcode ?? "未设置" : "当前资料不可用"}</p><p className="text-xs text-muted-foreground">批次 ID：{lotId}</p></div>;
}
