"use client";
import { type FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WmsCommandInput } from "@/lib/wms/contracts";

export function WmsLocationFreezeForm({ item, workspaceId, onClose, onComplete }: {
  item: Record<string, unknown>; workspaceId: string; onClose: () => void; onComplete: () => void;
}) {
  const label = item.frozen === true ? "解冻" : "冻结";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const pending = useRef<WmsCommandInput | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !reason.trim()) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      pending.current ??= { workspaceId, aggregateId: String(item.id), expectedRevision: Number(item.revision), idempotencyKey: crypto.randomUUID(), payload: { action: item.frozen === true ? "LOCATION_UNFREEZE" : "LOCATION_FREEZE", reason: reason.trim() } };
      const response = await fetch("/api/operations/wms/approvals", { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify(pending.current) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "提交失败，请刷新后重试。");
      onComplete();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，可重试当前申请。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} aria-label={`${label}库位作业`} className="space-y-3 rounded-lg border border-border bg-surface p-4">
    <h3 className="font-semibold">{label}库位 · {String(item.code)}</h3>
    <p className="text-sm text-muted-foreground">冻结暂停该库位库存作业，实物与预占数量保持原值；另一名成员审批后，由申请人执行。</p>
    <label className="grid gap-1 text-sm">{label}原因<textarea required maxLength={500} disabled={busy} value={reason} onChange={event => { setReason(event.target.value); pending.current = null; }} className="rounded border border-input bg-background p-2" /></label>
    <div className="flex gap-2"><Button type="submit" disabled={busy || !reason.trim()}>申请{label}</Button><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>关闭作业</Button></div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </form>;
}
