"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { WmsReservationStock } from "./wms-reservation-stock";
import type { ReservationStockContext } from "@/lib/wms/reservation-view";

type Balance = { id: string; available: number; stock: ReservationStockContext | null };
export function FbaLocalPlanForm({ workspaceId, sellerAccountId, marketplaceId, onCreated, onClose, onBusyChange }: {
  workspaceId: string; sellerAccountId: string; marketplaceId: string; onCreated: (message: string) => void; onClose: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [number, setNumber] = useState("");
  const [items, setItems] = useState<Balance[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [barcode, setBarcode] = useState(""), [appliedBarcode, setAppliedBarcode] = useState("");
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const selected = useRef(new Map<string, Balance>());
  const generation = useRef(0), inFlight = useRef(false);
  const requestKey = useRef<string | null>(null);
  const load = useCallback(async () => {
    const epoch = ++generation.current;
    setLoading(true); setError(""); setItems([]);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      if (appliedBarcode) params.set("barcode", appliedBarcode);
      const response = await fetch(`/api/operations/wms/balances?${params}`, { cache: "no-store", headers: { "x-workspace-id": workspaceId } });
      const result = await response.json();
      if (epoch !== generation.current) return;
      if (!response.ok) throw Error(result.error || "读取可用库存失败。");
      setItems(result.items); setNextCursor(result.nextCursor);
    } catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : "读取库存失败。"); }
    finally { if (epoch === generation.current) setLoading(false); }
  }, [workspaceId, cursor, appliedBarcode]);
  const invalidate = useCallback(() => { ++generation.current; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  function changeQuantity(item: Balance, value: string) {
    requestKey.current = null;
    setQuantities(current => ({ ...current, [item.id]: value }));
    if (value && value !== "0") selected.current.set(item.id, item); else selected.current.delete(item.id);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const lines = [...selected.current.values()].map(item => ({ balanceId: item.id, quantity: Number(quantities[item.id]) }));
    if (!lines.length || lines.length > 100 || lines.some(line => !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > selected.current.get(line.balanceId)!.available)) { setError("请选择 1-100 条库存，数量须为当前可用范围内的正整数。"); return; }
    inFlight.current = true; setBusy(true); onBusyChange(true); setError("");
    try {
      requestKey.current ??= crypto.randomUUID();
      const response = await fetch("/api/operations/fba-local-plans", { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify({ number, sellerAccountId, marketplaceId, idempotencyKey: requestKey.current, lines }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "创建计划失败。");
      onCreated("本地计划已创建，请逐行申请库存预占。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建计划失败，可重试。"); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  return <div className="space-y-4">
    <label className="grid gap-1 text-sm">计划单号<input aria-label="计划单号" required maxLength={120} disabled={busy} value={number} onChange={event => { requestKey.current = null; setNumber(event.target.value); }} className="h-9 rounded border border-input bg-background px-3" /></label>
    <form aria-label="筛选计划库存" className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setHistory([]); setCursor(null); setAppliedBarcode(barcode.trim()); if (appliedBarcode === barcode.trim() && !cursor) void load(); }}>
      <label className="grid gap-1 text-sm">商品条码<input aria-label="商品条码" disabled={busy} value={barcode} onChange={event => setBarcode(event.target.value)} className="h-9 rounded border border-input bg-background px-3" /></label>
      <Button type="submit" variant="secondary" disabled={loading || busy}>查询库存</Button>
    </form>
    {loading && <p role="status">读取库存…</p>}
    <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">仓库 / 库位 / 批次</th><th className="p-2">可用数量</th><th className="p-2">计划数量</th></tr></thead><tbody>{items.map(item => <tr key={item.id} className="border-t border-border"><td className="p-2"><WmsReservationStock stock={item.stock} /></td><td className="p-2">{item.available}</td><td className="p-2"><input aria-label={`计划数量 ${item.stock?.lotCode ?? item.id}`} type="number" min={0} max={item.available} step={1} disabled={busy || item.available <= 0} value={quantities[item.id] ?? ""} onChange={event => changeQuantity(item, event.target.value)} className="h-9 w-24 rounded border border-input bg-background px-2" /></td></tr>)}</tbody></table>{!loading && !items.length && <p className="py-4 text-sm text-muted">没有匹配的库存。</p>}</div>
    <div className="flex items-center justify-between gap-2 text-xs"><span>已选 {selected.current.size} 条库存</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={loading || busy || !history.length} onClick={() => { setCursor(history.at(-1) ?? null); setHistory(current => current.slice(0, -1)); }}>上一页库存</Button><Button size="sm" variant="secondary" disabled={loading || busy || !nextCursor} onClick={() => { setHistory(current => [...current, cursor]); setCursor(nextCursor); }}>下一页库存</Button></div></div>
    {selected.current.size > 0 && <div className="space-y-1 rounded border border-border p-2 text-sm" aria-label="已选计划库存">{[...selected.current.values()].map(item => <div key={item.id} className="flex justify-between gap-2"><span>{item.stock?.lotCode ?? item.id} · {quantities[item.id]}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => changeQuantity(item, "")}>移除 {item.stock?.lotCode ?? item.id}</Button></div>)}</div>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <form onSubmit={submit} aria-label="新建本地计划"><div className="flex gap-2"><Button type="submit" disabled={busy || loading || !number.trim() || !selected.current.size}>保存本地计划</Button><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消新建</Button></div></form>
  </div>;
}
