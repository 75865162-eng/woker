"use client";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

import { WmsReceiptLot } from "./wms-receipt-lot";
import type { ReceiptLotContext } from "@/lib/wms/receipt-view";

type Receipt = { id: string; revision: number; lines: Array<{ id: string; lotId: string; lot?: ReceiptLotContext | null; expectedQty: number }> };
export function WmsReceiptDraftForm({ receipt, workspaceId, onClose, onComplete }: { receipt: Receipt; workspaceId: string; onClose: () => void; onComplete: () => void }) {
  const [quantities, setQuantities] = useState(() => Object.fromEntries(receipt.lines.map(line => [line.id, String(line.expectedQty)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/operations/wms/receipts", { method: "PATCH", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify({ id: receipt.id, revision: receipt.revision, lines: receipt.lines.map(line => ({ lineId: line.id, expectedQty: Number(quantities[line.id]) })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "草稿保存失败。");
      onComplete();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "草稿保存失败，请刷新核对后重试。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <form aria-label="编辑收货草稿" onSubmit={submit} className="space-y-3 rounded-lg border border-border p-4">
    <h3 className="font-semibold">修改草稿计划数量</h3>
    <p className="text-sm text-muted-foreground">仅可修改未收货、未关联采购单的本人草稿。保存后需按新版本重新申请收货审批。</p>
    {receipt.lines.map(line => <div key={line.id} className="grid gap-1 text-sm"><WmsReceiptLot lotId={line.lotId} lot={line.lot} /><input aria-label={`${line.lotId} 计划数量`} required disabled={busy} type="number" min={1} max={2147483647} step={1} value={quantities[line.id]} onChange={event => setQuantities(current => ({ ...current, [line.id]: event.target.value }))} className="h-9 rounded border border-input bg-background px-3" /></div>)}
    <div className="flex gap-2"><Button type="submit" disabled={busy}>保存草稿</Button><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>关闭编辑</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
