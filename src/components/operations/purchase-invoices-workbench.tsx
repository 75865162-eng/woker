"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

const scopeKey = "tiaotiao.workspace.scope";
function workspaceId() { try { return (JSON.parse(localStorage.getItem(scopeKey) ?? "{}") as { workspaceId?: string }).workspaceId || "default"; } catch { return "default"; } }
function headers(json = false) { const result = new Headers({ "x-workspace-id": workspaceId() }); if (json) result.set("content-type", "application/json"); return result; }

type OrderOption = { id: string; number: string; status: string; currency: string; supplier: { id: string; name: string } };
type ReconciliationLine = { productRecordId: string; sku: string; name: string; orderedQty: number; receivedQty: number; invoicedQty: number; remainingQty: number; unitPrice: string; orderedAmount: string; invoicedAmount: string };
type Reconciliation = { order: { id: string; number: string; status: string; currency: string; supplier: { id: string; name: string } }; lines: ReconciliationLine[] };
type InvoiceLine = { id: string; productRecordId: string; orderedQty: number; receivedQty: number; invoicedQty: number; poUnitPrice: string; unitPrice: string; amount: string; taxAmount: string; varianceQty: number; varianceAmount: string; exceptionCodes: string[]; product?: { sku: string; chineseName: string; englishName: string } };
type Invoice = { id: string; number: string; supplierInvoiceNo: string; status: string; matchStatus: string; invoiceDate: string; dueDate: string | null; currency: string; totalAmount: string; subtotal: string; taxAmount: string; exceptionSummary: string; overrideReason: string; revision: number; supplier: { id: string; name: string }; purchaseOrder: { id: string; number: string }; lines: InvoiceLine[]; approvals?: Array<{ id: string; revision: number }> };

const invoiceStatusLabels: Record<string, string> = { DRAFT: "草稿", PENDING_APPROVAL: "待审批", APPROVED: "已核准", VOID: "已作废" };
const matchLabels: Record<string, string> = { PENDING: "待匹配", MATCHED: "三单一致", EXCEPTION: "存在差异" };
const codeLabels: Record<string, string> = {
  NO_RECEIPT: "未收货", QTY_OVER_ORDER: "超订单量", QTY_OVER_RECEIPT: "超验收量",
  CUMULATIVE_OVER_RECEIPT: "累计超验收", PRICE_VARIANCE: "单价差异", AMOUNT_MISMATCH: "金额不符",
};
const inputCls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: string | number) => Number(value).toFixed(2);

export function PurchaseInvoicesWorkbench() {
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [orderId, setOrderId] = useState("");
  const [picked, setPicked] = useState<Record<string, { qty: string; price: string }>>({});
  const [form, setForm] = useState({ number: "", supplierInvoiceNo: "", invoiceDate: today(), dueDate: "", priceTolerancePct: "0.5", qtyTolerancePct: "0", overrideReason: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/operations/procurement/invoices", { headers: headers(), cache: "no-store" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "采购发票读取失败。"); return; }
    setOrders(data.orders ?? []);
    setInvoices(data.invoices ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadOrder = useCallback(async (id: string) => {
    if (!id) { setReconciliation(null); setPicked({}); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/operations/procurement/invoices?view=reconciliation&orderId=${encodeURIComponent(id)}`, { headers: headers(), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "三单对账读取失败。");
      setReconciliation(data);
      const next: Record<string, { qty: string; price: string }> = {};
      for (const line of data.lines as ReconciliationLine[]) if (line.remainingQty > 0) next[line.productRecordId] = { qty: String(line.remainingQty), price: line.unitPrice };
      setPicked(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "三单对账读取失败。"); setReconciliation(null); }
    finally { setBusy(false); }
  }, []);

  const pickedRows = useMemo(() => (reconciliation?.lines ?? []).filter(line => picked[line.productRecordId] && Number(picked[line.productRecordId].qty) > 0), [reconciliation, picked]);
  const total = pickedRows.reduce((sum, line) => sum + Number(picked[line.productRecordId]?.qty ?? 0) * Number(picked[line.productRecordId]?.price ?? 0), 0);

  function draftNumber() {
    return `PI-${today().replace(/-/g, "")}-${String(invoices.length + 1).padStart(3, "0")}`;
  }

  async function createInvoice(event: React.FormEvent) {
    event.preventDefault();
    if (!reconciliation) { setError("先选择采购订单。"); return; }
    if (!pickedRows.length) { setError("至少填写一行开票数量。"); return; }
    const lines = pickedRows.map(line => ({
      productRecordId: line.productRecordId,
      invoicedQty: Number(picked[line.productRecordId].qty),
      unitPrice: picked[line.productRecordId].price,
    }));
    if (lines.some(line => !Number.isInteger(line.invoicedQty) || line.invoicedQty < 1)) { setError("开票数量必须是大于 0 的整数。"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operations/procurement/invoices", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({
          action: "invoice",
          number: form.number || draftNumber(),
          supplierInvoiceNo: form.supplierInvoiceNo,
          purchaseOrderId: reconciliation.order.id,
          invoiceDate: form.invoiceDate,
          dueDate: form.dueDate || undefined,
          priceToleranceBp: Math.round(Number(form.priceTolerancePct || "0") * 100),
          qtyToleranceBp: Math.round(Number(form.qtyTolerancePct || "0") * 100),
          overrideReason: form.overrideReason,
          lines,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "发票登记失败。");
      setNotice(`发票 ${data.invoice.number} 已登记，匹配结果：${matchLabels[data.invoice.matchStatus] ?? data.invoice.matchStatus}${data.invoice.exceptionSummary ? `（${data.invoice.exceptionSummary}）` : ""}`);
      setForm({ ...form, number: "", supplierInvoiceNo: "", dueDate: "", overrideReason: "" });
      await load();
      await loadOrder(reconciliation.order.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发票登记失败。"); }
    finally { setBusy(false); }
  }

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operations/procurement/invoices", { method: "PATCH", headers: headers(true), body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "操作失败。");
      setNotice(success);
      await load();
      if (reconciliation) await loadOrder(reconciliation.order.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-border p-4">
        <h3 className="text-sm font-semibold">登记供应商发票 · 三单匹配</h3>
        <p className="mt-1 text-xs text-muted">
          可开票数量 = 质检合格数量（acceptedQty），被拒收的数量不能开票。开票数量超过验收量、单价超出容差、累计开票超验收都会记为差异；差异发票必须写明放行理由才能提交审批，且申请人不能自批。
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs">采购订单
            <select aria-label="采购订单" className={inputCls} value={orderId} onChange={event => { setOrderId(event.target.value); void loadOrder(event.target.value); }}>
              <option value="">选择待开票采购单</option>
              {orders.map(order => <option key={order.id} value={order.id}>{order.number} · {order.supplier.name}</option>)}
            </select>
          </label>
          {reconciliation && <span className="text-xs text-muted">供应商：{reconciliation.order.supplier.name} · 币种 {reconciliation.order.currency}</span>}
        </div>

        {reconciliation && (
          <form onSubmit={createInvoice} className="mt-4 space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead><tr className="text-muted">{["SKU", "订单量", "已验收", "已开票", "可开票", "订单单价", "本次开票数", "开票单价"].map(head => <th key={head} className="pb-2 font-medium">{head}</th>)}</tr></thead>
                <tbody>
                  {reconciliation.lines.map(line => {
                    const row = picked[line.productRecordId];
                    return (
                      <tr key={line.productRecordId} className="border-t border-border">
                        <td className="py-2">{line.sku}<span className="ml-1 text-muted">{line.name}</span></td>
                        <td>{line.orderedQty}</td>
                        <td>{line.receivedQty}</td>
                        <td>{line.invoicedQty}</td>
                        <td className={line.remainingQty > 0 ? "font-semibold text-brand" : "text-muted"}>{line.remainingQty}</td>
                        <td>{line.unitPrice}</td>
                        <td>{row ? <input aria-label={`${line.sku} 开票数量`} className={inputCls + " w-20"} value={row.qty} onChange={event => setPicked({ ...picked, [line.productRecordId]: { ...row, qty: event.target.value } })} /> : <span className="text-muted">已开完</span>}</td>
                        <td>{row ? <input aria-label={`${line.sku} 开票单价`} className={inputCls + " w-24"} value={row.price} onChange={event => setPicked({ ...picked, [line.productRecordId]: { ...row, price: event.target.value } })} /> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
              <label className="grid gap-1 text-xs">内部编号<input aria-label="内部编号" placeholder={draftNumber()} className={inputCls} value={form.number} onChange={event => setForm({ ...form, number: event.target.value })} /></label>
              <label className="grid gap-1 text-xs">供应商发票号<input aria-label="供应商发票号" required className={inputCls} value={form.supplierInvoiceNo} onChange={event => setForm({ ...form, supplierInvoiceNo: event.target.value })} /></label>
              <label className="grid gap-1 text-xs">开票日期<input aria-label="开票日期" type="date" className={inputCls} value={form.invoiceDate} onChange={event => setForm({ ...form, invoiceDate: event.target.value })} /></label>
              <label className="grid gap-1 text-xs">到期日期<input aria-label="到期日期" type="date" className={inputCls} value={form.dueDate} onChange={event => setForm({ ...form, dueDate: event.target.value })} /></label>
              <label className="grid gap-1 text-xs">单价容差 %<input aria-label="单价容差" className={inputCls + " w-20"} value={form.priceTolerancePct} onChange={event => setForm({ ...form, priceTolerancePct: event.target.value })} /></label>
              <label className="grid gap-1 text-xs">数量容差 %<input aria-label="数量容差" className={inputCls + " w-20"} value={form.qtyTolerancePct} onChange={event => setForm({ ...form, qtyTolerancePct: event.target.value })} /></label>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid flex-1 gap-1 text-xs">差异放行理由（存在差异时必填）<input aria-label="差异放行理由" className={inputCls + " w-full"} value={form.overrideReason} onChange={event => setForm({ ...form, overrideReason: event.target.value })} /></label>
              <Button type="submit" size="sm" disabled={busy || !pickedRows.length}>登记发票（{pickedRows.length} 行 · {reconciliation.order.currency} {money(total)}）</Button>
            </div>
          </form>
        )}
      </section>

      {notice && <p role="status" className="rounded border border-border p-3 text-xs">{notice}</p>}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}

      <section className="rounded border border-border p-4">
        <h3 className="text-sm font-semibold">发票台账</h3>
        {!invoices.length && <p className="mt-2 text-sm text-muted">还没有登记发票。选择一张已下单的采购单，按验收数量登记第一张发票。</p>}
        <div className="mt-3 space-y-2">
          {invoices.map(invoice => {
            const approval = invoice.approvals?.[0];
            return (
              <article key={invoice.id} className="rounded border border-border p-3">
                <div className="flex flex-wrap items-baseline gap-3 text-sm">
                  <strong>{invoice.number}</strong>
                  <span className="text-muted">供应商票号 {invoice.supplierInvoiceNo}</span>
                  <span className="text-muted">采购单 {invoice.purchaseOrder.number}</span>
                  <span>{invoice.invoiceDate}{invoice.dueDate ? ` → ${invoice.dueDate}` : ""}</span>
                  <span className="font-semibold">{invoice.currency} {money(invoice.totalAmount)}</span>
                  <span className={invoice.matchStatus === "EXCEPTION" ? "rounded bg-red-50 px-2 py-0.5 text-xs text-red-800" : "rounded bg-surface-muted px-2 py-0.5 text-xs"}>{matchLabels[invoice.matchStatus] ?? invoice.matchStatus}</span>
                  <span className="rounded bg-surface-muted px-2 py-0.5 text-xs">{invoiceStatusLabels[invoice.status] ?? invoice.status}</span>
                  <span className="ml-auto flex flex-wrap gap-2">
                    {invoice.status === "DRAFT" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act({ action: "rematch", id: invoice.id, revision: invoice.revision }, "已按最新收货与开票情况重新匹配。")}>重新匹配</Button>}
                    {invoice.status === "DRAFT" && <Button size="sm" disabled={busy} onClick={() => void act({ action: "submit-approval", id: invoice.id, revision: invoice.revision, overrideReason: invoice.overrideReason }, "已提交审批。")}>提交审批</Button>}
                    {invoice.status === "PENDING_APPROVAL" && approval && <Button size="sm" disabled={busy} onClick={() => void act({ decision: "APPROVE", id: approval.id, revision: approval.revision, reason: "" }, "发票已核准。")}>批准</Button>}
                    {["DRAFT", "PENDING_APPROVAL"].includes(invoice.status) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: "void-invoice", id: invoice.id, revision: invoice.revision, reason: "发票错误重开" }, "发票已作废。")}>作废</Button>}
                    {invoice.status === "APPROVED" && <a className="inline-flex h-8 items-center rounded border border-border px-3 text-xs hover:bg-surface-muted" href={`/operations/finance-ledger?${new URLSearchParams({ sourceKind: "PURCHASE_INVOICE", sourceId: invoice.id })}`}>转入总账</a>}
                  </span>
                </div>
                {invoice.exceptionSummary && <p className="mt-2 text-xs text-red-800">{invoice.exceptionSummary}{invoice.overrideReason ? `　放行理由：${invoice.overrideReason}` : "　（未填放行理由，无法提交审批）"}</p>}
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-brand">三单对比明细</summary>
                  <table className="mt-2 w-full min-w-[760px] text-left">
                    <thead><tr className="text-muted">{["SKU", "订单量", "已验收", "开票量", "订单单价", "开票单价", "金额", "差异", "问题"].map(head => <th key={head} className="pb-1 font-medium">{head}</th>)}</tr></thead>
                    <tbody>
                      {invoice.lines.map(line => (
                        <tr key={line.id} className="border-t border-border">
                          <td className="py-1">{line.product?.sku ?? line.productRecordId}</td>
                          <td>{line.orderedQty}</td>
                          <td>{line.receivedQty}</td>
                          <td>{line.invoicedQty}</td>
                          <td>{line.poUnitPrice}</td>
                          <td>{line.unitPrice}</td>
                          <td>{line.amount}</td>
                          <td className={Number(line.varianceAmount) === 0 ? "text-muted" : "text-red-800"}>{line.varianceQty} / {line.varianceAmount}</td>
                          <td>{line.exceptionCodes.length ? line.exceptionCodes.map(code => codeLabels[code] ?? code).join("、") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
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
