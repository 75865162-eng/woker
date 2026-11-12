"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type PaymentRecord = { id: string; paidAt: string; amount: string; currency: string; method: string; reference: string; notes: string; refunds: Array<{ id: string; refundedAt: string; amount: string; currency: string; method: string; reference: string; notes: string }> };
const methodLabels: Record<string, string> = { BANK_TRANSFER: "银行转账", PAYPAL: "PayPal", CASH: "现金", OTHER: "其他" };

// Adapted from Wimoor purchase/orders/components/pay_record.vue, retaining the ERP ledger contract.
// Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt.
export function PurchasePaymentRecords({ payments }: { payments: PaymentRecord[] }) {
  const [mode, setMode] = useState<"table" | "cards">("table");
  const ledgerHref = (sourceId: string, sourceKind = "PURCHASE_PAYMENT") => `/operations/finance-ledger?${new URLSearchParams({ sourceKind, sourceId })}`;
  if (!payments.length) return <p className="text-sm text-muted">暂无已复核登记的付款记录。</p>;
  return <section aria-label="已登记采购付款记录" className="space-y-3">
    <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" aria-pressed={mode === "table"} onClick={() => setMode("table")}>表格记录</Button><Button type="button" size="sm" variant="secondary" aria-pressed={mode === "cards"} onClick={() => setMode("cards")}>卡片记录</Button></div>
    {mode === "table" ? <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["付款日期", "金额", "方式", "流水号", "备注", "操作"].map(label => <th key={label} className="border-b border-border p-2">{label}</th>)}</tr></thead><tbody>{payments.map(payment => <Fragment key={payment.id}><tr><td className="p-2">{payment.paidAt.slice(0, 10)}</td><td className="p-2 tabular-nums">{payment.amount} {payment.currency}</td><td className="p-2">{methodLabels[payment.method] ?? payment.method}</td><td className="p-2">{payment.reference}</td><td className="p-2">{payment.notes || "—"}</td><td className="p-2"><Link className="text-primary underline-offset-4 hover:underline" href={ledgerHref(payment.id)}>转入总账</Link></td></tr>{payment.refunds.map(refund => <tr key={refund.id} className="bg-muted/20"><td className="p-2 pl-6">退款 · {refund.refundedAt.slice(0, 10)}</td><td className="p-2 tabular-nums">−{refund.amount} {refund.currency}</td><td className="p-2">{methodLabels[refund.method] ?? refund.method}</td><td className="p-2">{refund.reference}</td><td className="p-2">{refund.notes || "—"}</td><td className="p-2"><Link className="text-primary underline-offset-4 hover:underline" href={ledgerHref(refund.id, "PURCHASE_REFUND")}>转入总账</Link></td></tr>)}</Fragment>)}</tbody></table></div> : <div className="grid gap-3 sm:grid-cols-2">{payments.map(payment => <article key={payment.id} className="space-y-3 rounded border border-border p-3"><header className="flex justify-between gap-3 text-xs text-muted"><span>{methodLabels[payment.method] ?? payment.method}</span><time dateTime={payment.paidAt}>{payment.paidAt.slice(0, 10)}</time></header><div className="flex justify-between gap-3 text-sm font-semibold"><span className="break-all">{payment.reference}</span><span className="whitespace-nowrap tabular-nums">{payment.amount} {payment.currency}</span></div><p className="whitespace-pre-wrap text-xs text-muted">备注：{payment.notes || "—"}</p><Link className="inline-flex text-sm text-primary underline-offset-4 hover:underline" href={ledgerHref(payment.id)}>转入总账</Link>{payment.refunds.map(refund => <div key={refund.id} className="space-y-1 border-t border-border pt-2 text-xs"><p>退款 · {refund.refundedAt.slice(0, 10)} · −{refund.amount} {refund.currency} · {methodLabels[refund.method] ?? refund.method}</p><p>{refund.reference} · {refund.notes || "—"}</p><Link className="inline-flex text-primary underline-offset-4 hover:underline" href={ledgerHref(refund.id, "PURCHASE_REFUND")}>退款转入总账</Link></div>)}</article>)}</div>}
    <p className="text-xs text-muted">仅展示经复核确认的付款凭证。退款由关联原付款的独立复核流程登记，不直接删除或撤销已登记凭证。</p>
  </section>;
}
