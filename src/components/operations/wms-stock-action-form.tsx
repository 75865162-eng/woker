"use client";
import { FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WmsCommandInput } from "@/lib/wms/contracts";
import { stockActionLabels, stockActionLimit, type StockAction } from "@/lib/wms/stock-action-view";
import { useWmsOptions } from "./use-wms-options";
import { WmsReservationStock } from "./wms-reservation-stock";
import type { ReservationStockContext } from "@/lib/wms/reservation-view";
import { WmsOptionsStatus } from "./wms-options-status";

export function WmsStockActionForm({ item, action, workspaceId, onClose, onComplete }: {
  item: Record<string, unknown>; action: StockAction; workspaceId: string;
  onClose: () => void; onComplete: (message: string, approvalRequired: boolean) => void;
}) {
  const limit = stockActionLimit(item, action);
  const [quantity, setQuantity] = useState("1");
  const [number, setNumber] = useState("");
  const [outboundLineId, setOutboundLineId] = useState("");
  const [targetLocationId, setTargetLocationId] = useState("");
  const [targetLotId, setTargetLotId] = useState("");
  const [reason, setReason] = useState("");
  const lots = useWmsOptions("lots", workspaceId, action === "SKU_CONVERT");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<WmsCommandInput | null>(null);
  const locations = useWmsOptions("locations", workspaceId, action === "TRANSFER");
  const stock = item.stock && typeof item.stock === "object" ? item.stock as Record<string, unknown> : {};
  const productRecordId = String(stock.productRecordId ?? "");
  const warehouseId = String(item.warehouseId ?? stock.warehouseId ?? "");
  const outboundQuery = new URLSearchParams({ productRecordId, warehouseId }).toString();
  const outboundOptions = useWmsOptions("outbounds", workspaceId, action === "RESERVE" && Boolean(productRecordId && warehouseId), outboundQuery);
  const targetLocations = locations.items.filter(location => location.enabled === true && location.frozen !== true && location.kind === "STORAGE" && location.id !== item.locationId);
  const outboundLines = outboundOptions.items.flatMap(outbound => (Array.isArray(outbound.lines) ? outbound.lines as Array<Record<string, unknown>> : []).map(line => ({ outbound, line })))
    .filter(({ outbound, line }) => ["DRAFT", "RELEASED"].includes(String(outbound.status)) && Number(line.allocatableQty) > 0 && line.productRecordId === productRecordId);
  const selectedDemand = outboundLines.find(({ line }) => line.id === outboundLineId);
  const currentLimit = outboundLineId ? Math.min(limit ?? 0, Number(selectedDemand?.line.allocatableQty ?? 0)) : limit;
  const needsApproval = action !== "PICK" && action !== "UNPICK";
  const label = stockActionLabels[action];
  function changed() { pending.current = null; setError(""); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const qty = Number(quantity);
    if (currentLimit === null || !Number.isSafeInteger(qty) || qty < 1 || qty > currentLimit) { setError("数量须为当前可操作数量内的正整数，请刷新后核对。"); return; }
    if (action === "RESERVE" && !number.trim()) { setError("请填写预占单号。"); return; }
    if (action === "SKU_CONVERT" && (!targetLotId || !reason.trim())) { setError("请选择目标批次并填写转换依据。"); return; }
    if (action === "TRANSFER" && !targetLocationId) { setError("请选择目标存储库位。"); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      pending.current ??= { workspaceId, aggregateId: String(item.id), expectedRevision: Number(item.revision), idempotencyKey: crypto.randomUUID(), payload: action === "SKU_CONVERT" ? {action, targetLotId, reason, quantity: qty} : action === "RESERVE" ? { action, number: number.trim(), quantity: qty, ...(outboundLineId ? { outboundLineId } : {}) } : action === "TRANSFER" ? { action, targetLocationId, quantity: qty } : { action, quantity: qty } };
      const response = await fetch(`/api/operations/wms/${needsApproval ? "approvals" : "commands"}`, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify(pending.current) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || `${label}失败，请核对当前数据后重试。`);
      onComplete(needsApproval ? `${label}申请已提交，等待另一名成员审批。` : `${label}已完成。`, needsApproval);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，可重试当前作业。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} aria-label={`${label}作业`} className="space-y-3 rounded-lg border border-border bg-surface p-4">
    <div className="flex items-center justify-between"><h3 className="font-semibold">{label} · {String(item.number ?? item.lotId ?? item.id)}</h3><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>关闭作业</Button></div>
    <WmsReservationStock stock={item.stock as ReservationStockContext | null | undefined} />
    <p className="text-sm text-muted-foreground">当前可{label}数量：{currentLimit ?? "需要重新读取"}{needsApproval ? "；批准后由申请人执行。" : "。"}</p>
    <div className="flex flex-wrap items-end gap-3">
      {action === "RESERVE" && <label className="grid gap-1 text-sm">预占单号<input required maxLength={120} disabled={busy} value={number} onChange={event => { changed(); setNumber(event.target.value); }} className="h-9 rounded border border-input bg-background px-3" /></label>}
      {action === "RESERVE" && <label className="grid gap-1 text-sm">关联出库需求<select disabled={busy} value={outboundLineId} onChange={event => { changed(); setOutboundLineId(event.target.value); }} className="h-9 min-w-64 rounded border border-input bg-background px-3"><option value="">不关联出库需求</option>{outboundLines.map(({ outbound, line }) => <option key={String(line.id)} value={String(line.id)}>{String(outbound.number)} · 剩余需求 {String(line.allocatableQty)}</option>)}</select></label>}
      {action === "SKU_CONVERT" && <><label className="grid gap-1 text-sm">目标商品批次<select aria-label="转换目标批次" required disabled={busy} value={targetLotId} onChange={event=>{changed();setTargetLotId(event.target.value);}} className="h-9 rounded border border-input bg-background px-3"><option value="">选择另一商品批次</option>{lots.items.filter(lot=>lot.productRecordId!==productRecordId).map(lot=><option key={String(lot.id)} value={String(lot.id)}>{String(lot.productRecordId)} / {String(lot.lotCode)}</option>)}</select></label><label className="grid gap-1 text-sm">转换依据<input required aria-label="转换依据" disabled={busy} value={reason} onChange={event=>{changed();setReason(event.target.value);}} className="h-9 rounded border border-input bg-background px-3" /></label><WmsOptionsStatus label="目标批次" options={lots}/></>}
      {action === "TRANSFER" && <><label className="grid gap-1 text-sm">目标存储库位<select aria-label="目标存储库位" required disabled={busy} value={targetLocationId} onChange={event => { changed(); setTargetLocationId(event.target.value); }} className="h-9 min-w-56 rounded border border-input bg-background px-3"><option value="">选择目标库位</option>{targetLocations.map(location => <option key={String(location.id)} value={String(location.id)}>{String(location.warehouseId)} · {String(location.code)}</option>)}</select></label><WmsOptionsStatus label="存储库位" options={locations} /></>}
      <label className="grid gap-1 text-sm">{label}数量<input required type="number" min={1} max={currentLimit ?? 0} step={1} disabled={busy} value={quantity} onChange={event => { changed(); setQuantity(event.target.value); }} className="h-9 w-32 rounded border border-input bg-background px-3" /></label>
      <Button type="submit" disabled={busy || !currentLimit}>{needsApproval ? `申请${label}` : `确认${label}`}</Button>
    </div>
    {action === "RESERVE" && <WmsOptionsStatus label="可关联需求单" options={outboundOptions} />}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </form>;
}
