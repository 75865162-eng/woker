"use client";
import { useRef, useState } from "react";
import type { FbaLocalPlansResult } from "@/lib/fba-local/service";
import type { LocalPackingBox } from "@/lib/fba-local/packing";
import { Button } from "@/components/ui/button";

type Plan = FbaLocalPlansResult["items"][number];
export function FbaLocalPackingForm({ plan, workspaceId, onSaved, onBusyChange }: {
  plan: Plan; workspaceId: string; onSaved: () => void; onBusyChange: (value: boolean) => void;
}) {
  const newBox = (): LocalPackingBox => ({ number: "", lengthCm: "", widthCm: "", heightCm: "", grossWeightKg: "", items: [] });
  const [boxes, setBoxes] = useState<LocalPackingBox[]>(plan.packing?.boxes ?? [newBox()]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  function update(index: number, change: Partial<LocalPackingBox>) { setBoxes(current => current.map((box, i) => i === index ? { ...box, ...change } : box)); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (lock.current) return;
    setError("");
    try {
      const packing = { boxes: boxes.map(({netWeightKg,...box})=>({...box,...(netWeightKg?{netWeightKg}:{})})) };
      lock.current = true; setBusy(true); onBusyChange(true);
      const response = await fetch("/api/operations/fba-local-plans", { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify({ action: "SAVE_PACKING", id: plan.id, expectedRevision: plan.revision, packing }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "保存装箱失败，请刷新核对。");
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  return <form aria-label="本地装箱资料" onSubmit={save} className="space-y-4">
    <p className="text-sm text-muted">{plan.number} · 每条明细的箱内数量合计须等于计划数量。尺寸单位为厘米，毛重单位为千克；均最多三位小数。此资料尚未提交 Amazon，不代表 Amazon 分仓方案。</p>
    {boxes.map((box, index) => <fieldset key={index} disabled={busy} className="space-y-3 rounded border border-border p-3">
      <legend className="px-1 text-sm">第 {index + 1} 箱</legend>
      <div className="flex flex-wrap gap-2">{([ ["number", "箱号"], ["lengthCm", "长（厘米）"], ["widthCm", "宽（厘米）"], ["heightCm", "高（厘米）"], ["grossWeightKg", "毛重（千克）"], ["netWeightKg", "净重（千克，可选）"] ] as const).map(([field, label]) => <label key={field} className="grid gap-1 text-xs">{label}<input aria-label={`第${index + 1}箱${label}`} required={field!=="netWeightKg"} maxLength={field === "number" ? 60 : 10} inputMode={field === "number" ? "text" : "decimal"} value={box[field]??""} onChange={event => update(index, { [field]: event.target.value })} className="h-9 w-32 rounded border border-input bg-background px-2" /></label>)}</div>
      {plan.lines.map((line, lineIndex) => <label key={line.id} className="flex flex-wrap items-center gap-2 text-sm"><span>明细 {lineIndex + 1} · {line.stock?.warehouseCode} / {line.stock?.locationCode} / {line.stock?.lotCode} · 计划 {line.quantity}</span><input aria-label={`第${index + 1}箱明细${lineIndex + 1}数量`} type="number" min={0} max={line.quantity} step={1} value={box.items.find(item => item.lineId === line.id)?.quantity ?? ""} onChange={event => update(index, { items: [...box.items.filter(item => item.lineId !== line.id), ...(event.target.value && Number(event.target.value) !== 0 ? [{ lineId: line.id, quantity: Number(event.target.value) }] : [])] })} className="h-9 w-24 rounded border border-input bg-background px-2" /></label>)}
      <Button type="button" variant="ghost" size="sm" disabled={busy || boxes.length === 1} onClick={() => setBoxes(current => current.filter((_, i) => i !== index))}>移除此箱</Button>
    </fieldset>)}
    <Button type="button" variant="secondary" disabled={busy || boxes.length >= 200} onClick={() => setBoxes(current => [...current, newBox()])}>添加箱子</Button>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div><Button type="submit" disabled={busy}>保存装箱资料</Button></div>
  </form>;
}
