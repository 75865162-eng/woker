"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

const scopeKey = "tiaotiao.workspace.scope";
function workspaceId() { try { return (JSON.parse(localStorage.getItem(scopeKey) ?? "{}") as { workspaceId?: string }).workspaceId || "default"; } catch { return "default"; } }
function headers(json = false) { const result = new Headers({ "x-workspace-id": workspaceId() }); if (json) result.set("content-type", "application/json"); return result; }

type Suggestion = { productRecordId: string; sku: string; name: string; availableQty: number; inboundQty: number; salesQty: number; suggestedQty: number; lastUnitPrice: string | null };
type PlanLine = { id: string; productRecordId: string; onHandQty: number; inboundQty: number; salesQty: number; suggestedQty: number; plannedQty: number; unitPrice: string; product?: { sku: string; chineseName: string; englishName: string } };
type Plan = { id: string; number: string; status: string; periodStart: string; periodEnd: string; revision: number; supplierId: string | null; supplier?: { id: string; name: string } | null; convertedOrderId: string | null; lines: PlanLine[]; approvals?: Array<{ id: string; revision: number }> };

const statusLabels: Record<string, string> = { DRAFT: "草稿", PENDING_APPROVAL: "待审批", APPROVED: "已批准·待转采购单", CONVERTED: "已转采购单", CANCELLED: "已作废", REJECTED: "已拒绝" };
const inputCls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";

function today(offsetDays = 0) { const date = new Date(Date.now() + offsetDays * 86_400_000); return date.toISOString().slice(0, 10); }

export function PurchasePlansWorkbench() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Record<string, { quantity: string; unitPrice: string }>>({});
  const [form, setForm] = useState({ number: "", supplierId: "", periodStart: today(), periodEnd: today(30), salesWindowDays: "90", coverageDays: "60", safetyDays: "15" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/operations/procurement/plans", { headers: headers(), cache: "no-store" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "采购计划读取失败。"); return; }
    setPlans(data.plans ?? []); setSuppliers(data.suppliers ?? []);
  }, []);

  const loadSuggestions = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ view: "suggestions", salesWindowDays: form.salesWindowDays, coverageDays: form.coverageDays, safetyDays: form.safetyDays });
      const response = await fetch(`/api/operations/procurement/plans?${params}`, { headers: headers(), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "需求推算失败。");
      setSuggestions(data.rows ?? []);
      setPicked({});
      setNotice(`已按 ${form.salesWindowDays} 天销量窗口推算 ${data.rows?.length ?? 0} 个 SKU。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "需求推算失败。"); }
    finally { setBusy(false); }
  }, [form.salesWindowDays, form.coverageDays, form.safetyDays]);

  useEffect(() => { void load(); }, [load]);

  const pickedRows = useMemo(() => suggestions.filter(row => picked[row.productRecordId]), [suggestions, picked]);
  const totalAmount = pickedRows.reduce((sum, row) => sum + Number(picked[row.productRecordId]?.quantity ?? 0) * Number(picked[row.productRecordId]?.unitPrice ?? 0), 0);

  function toggle(row: Suggestion) {
    setPicked(current => {
      const next = { ...current };
      if (next[row.productRecordId]) delete next[row.productRecordId];
      else next[row.productRecordId] = { quantity: String(row.suggestedQty > 0 ? row.suggestedQty : 1), unitPrice: row.lastUnitPrice ?? "0" };
      return next;
    });
  }

  async function createPlan(event: React.FormEvent) {
    event.preventDefault();
    if (!pickedRows.length) { setError("先勾选至少一个 SKU。"); return; }
    const lines = pickedRows.map(row => ({
      productRecordId: row.productRecordId,
      plannedQty: Number(picked[row.productRecordId].quantity),
      unitPrice: picked[row.productRecordId].unitPrice,
      onHandQty: row.availableQty,
      inboundQty: row.inboundQty,
      salesQty: row.salesQty,
      suggestedQty: row.suggestedQty,
    }));
    if (lines.some(line => !Number.isInteger(line.plannedQty) || line.plannedQty < 1)) { setError("计划数量必须是大于 0 的整数。"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operations/procurement/plans", { method: "POST", headers: headers(true), body: JSON.stringify({ action: "plan", number: form.number, supplierId: form.supplierId || undefined, periodStart: form.periodStart, periodEnd: form.periodEnd, salesWindowDays: Number(form.salesWindowDays), coverageDays: Number(form.coverageDays), safetyDays: Number(form.safetyDays), lines }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "计划创建失败。");
      setNotice(`计划 ${data.plan.number} 已保存为草稿，请在下方提交审批。`);
      setPicked({}); setForm({ ...form, number: "" });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "计划创建失败。"); }
    finally { setBusy(false); }
  }

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operations/procurement/plans", { method: "PATCH", headers: headers(true), body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "操作失败。");
      setNotice(success); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-border p-4">
        <h3 className="text-sm font-semibold">需求推算口径</h3>
        <p className="mt-1 text-xs text-muted">建议量 = 日均销量 ×（覆盖天数 + 安全天数）− 公司仓可用 − 在途。销量取 Amazon 订单明细窗口内下单量，不含取消单。</p>
        <form onSubmit={createPlan} className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs">销量窗口（天）<input aria-label="销量窗口天数" className={inputCls} value={form.salesWindowDays} onChange={e => setForm({ ...form, salesWindowDays: e.target.value })} /></label>
            <label className="grid gap-1 text-xs">覆盖天数<input aria-label="覆盖天数" className={inputCls} value={form.coverageDays} onChange={e => setForm({ ...form, coverageDays: e.target.value })} /></label>
            <label className="grid gap-1 text-xs">安全天数<input aria-label="安全天数" className={inputCls} value={form.safetyDays} onChange={e => setForm({ ...form, safetyDays: e.target.value })} /></label>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void loadSuggestions()}>刷新建议</Button>
          </div>
          {suggestions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead><tr className="text-muted">{["", "SKU", "名称", "可用", "在途", "窗口销量", "建议量", "计划量", "单价"].map(head => <th key={head} className="pb-2 font-medium">{head}</th>)}</tr></thead>
                <tbody>
                  {suggestions.map(row => (
                    <tr key={row.productRecordId} className="border-t border-border">
                      <td className="py-2"><input type="checkbox" aria-label={`选择 ${row.sku}`} checked={Boolean(picked[row.productRecordId])} onChange={() => toggle(row)} /></td>
                      <td>{row.sku}</td>
                      <td>{row.name}</td>
                      <td>{row.availableQty}</td>
                      <td>{row.inboundQty}</td>
                      <td>{row.salesQty}</td>
                      <td className={row.suggestedQty > 0 ? "font-semibold text-brand" : "text-muted"}>{row.suggestedQty > 0 ? row.suggestedQty : "—"}</td>
                      <td>{picked[row.productRecordId] ? <input aria-label={`${row.sku} 计划数量`} className={inputCls + " w-20"} value={picked[row.productRecordId].quantity} onChange={e => setPicked({ ...picked, [row.productRecordId]: { ...picked[row.productRecordId], quantity: e.target.value } })} /> : <span className="text-muted">未选</span>}</td>
                      <td>{picked[row.productRecordId] ? <input aria-label={`${row.sku} 单价`} className={inputCls + " w-24"} value={picked[row.productRecordId].unitPrice} onChange={e => setPicked({ ...picked, [row.productRecordId]: { ...picked[row.productRecordId], unitPrice: e.target.value } })} /> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
            <label className="grid gap-1 text-xs">计划单号<input aria-label="计划单号" required className={inputCls} value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} /></label>
            <label className="grid gap-1 text-xs">供应商（可后补）<select aria-label="供应商" className={inputCls} value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })}><option value="">未指定</option>{suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="grid gap-1 text-xs">计划期开始<input aria-label="计划期开始" type="date" className={inputCls} value={form.periodStart} onChange={e => setForm({ ...form, periodStart: e.target.value })} /></label>
            <label className="grid gap-1 text-xs">计划期结束<input aria-label="计划期结束" type="date" className={inputCls} value={form.periodEnd} onChange={e => setForm({ ...form, periodEnd: e.target.value })} /></label>
            <Button type="submit" size="sm" disabled={busy || !pickedRows.length}>保存计划草稿（{pickedRows.length} 行 · ¥{totalAmount.toFixed(2)}）</Button>
          </div>
        </form>
      </section>

      {notice && <p role="status" className="rounded border border-border p-3 text-xs">{notice}</p>}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}

      <section className="rounded border border-border p-4">
        <h3 className="text-sm font-semibold">采购计划单</h3>
        {!plans.length && <p className="mt-2 text-sm text-muted">还没有计划单。先按上面的口径推算，再勾选 SKU 建计划。</p>}
        <div className="mt-3 space-y-2">
          {plans.map(plan => {
            const approval = plan.approvals?.[0];
            const amount = plan.lines.reduce((sum, line) => sum + Number(line.unitPrice) * line.plannedQty, 0);
            return (
              <article key={plan.id} className="rounded border border-border p-3">
                <div className="flex flex-wrap items-baseline gap-3 text-sm">
                  <strong>{plan.number}</strong>
                  <span className="text-muted">{plan.periodStart} ~ {plan.periodEnd}</span>
                  <span className="text-muted">{plan.supplier?.name ?? "未指定供应商"}</span>
                  <span>{plan.lines.length} 行 · ¥{amount.toFixed(2)}</span>
                  <span className="rounded bg-surface-muted px-2 py-0.5 text-xs">{statusLabels[plan.status] ?? plan.status}</span>
                  <span className="ml-auto flex flex-wrap gap-2">
                    {plan.status === "DRAFT" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act({ action: "submit-approval", id: plan.id, revision: plan.revision }, "已提交审批。")}>提交审批</Button>}
                    {plan.status === "PENDING_APPROVAL" && approval && <Button size="sm" disabled={busy} onClick={() => void act({ decision: "APPROVE", id: approval.id, revision: approval.revision, reason: "" }, "计划已批准。")}>批准</Button>}
                    {plan.status === "APPROVED" && <Button size="sm" disabled={busy} onClick={() => void act({ action: "convert-plan", id: plan.id, revision: plan.revision, orderNumber: `PO-${plan.number}`, expectedAt: plan.periodEnd }, "已生成采购单草稿，请到采购订单里提交审批并下单。")}>转采购单</Button>}
                    {["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(plan.status) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: "cancel-plan", id: plan.id, revision: plan.revision, reason: "经营计划调整" }, "计划已作废。")}>作废</Button>}
                  </span>
                </div>
                <details className="mt-2 text-xs"><summary className="cursor-pointer text-brand">查看明细</summary>
                  <table className="mt-2 w-full min-w-[620px] text-left">
                    <thead><tr className="text-muted">{["SKU", "可用", "在途", "窗口销量", "建议", "计划", "单价"].map(head => <th key={head} className="pb-1 font-medium">{head}</th>)}</tr></thead>
                    <tbody>{plan.lines.map(line => <tr key={line.id} className="border-t border-border"><td className="py-1">{line.product?.sku ?? line.productRecordId}</td><td>{line.onHandQty}</td><td>{line.inboundQty}</td><td>{line.salesQty}</td><td>{line.suggestedQty}</td><td>{line.plannedQty}</td><td>{line.unitPrice}</td></tr>)}</tbody>
                  </table>
                </details>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
