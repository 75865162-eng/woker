"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

type PaymentRecord = { id: string; paidAt: string; amount: string; currency: string; method: string; reference: string; notes: string; refunds: Array<{ id: string; refundedAt: string; amount: string; currency: string; method: string; reference: string; notes: string }> };
type LedgerRow =
  | { kind: "payment"; id: string; date: string; amount: string; currency: string; method: string; reference: string; notes: string }
  | { kind: "refund"; id: string; date: string; amount: string; currency: string; method: string; reference: string; notes: string };
const methodLabels: Record<string, string> = { BANK_TRANSFER: "银行转账", PAYPAL: "PayPal", CASH: "现金", OTHER: "其他" };

// Adapted from Wimoor purchase/orders/components/pay_record.vue, retaining the ERP ledger contract.
// Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt.
export function PurchasePaymentRecords({ payments }: { payments: PaymentRecord[] }) {
  const [mode, setMode] = useState<"table" | "cards">("table");
  const ledgerHref = (sourceId: string, sourceKind = "PURCHASE_PAYMENT") => `/operations/finance-ledger?${new URLSearchParams({ sourceKind, sourceId })}`;
  if (!payments.length) return <p className="text-sm text-muted">暂无已复核登记的付款记录。</p>;

  // 「一行付款 + N 行退款」的行组结构：付款在前、退款紧随并缩进着色，
  // 用同一份行模型保持 DOM 配对顺序（转入总账链接的第 N 个对应第 N 张凭证）。
  const rows: LedgerRow[] = payments.flatMap((payment): LedgerRow[] => [
    { kind: "payment", id: payment.id, date: payment.paidAt.slice(0, 10), amount: payment.amount, currency: payment.currency, method: payment.method, reference: payment.reference, notes: payment.notes },
    ...payment.refunds.map((refund): LedgerRow => ({ kind: "refund", id: refund.id, date: refund.refundedAt.slice(0, 10), amount: refund.amount, currency: refund.currency, method: refund.method, reference: refund.reference, notes: refund.notes })),
  ]);

  const columns: DataTableColumn<LedgerRow>[] = [
    {
      key: "date",
      header: "付款日期",
      render: (row) => row.kind === "refund" ? <span className="pl-4">退款 · {row.date}</span> : row.date,
    },
    {
      key: "amount",
      header: "金额",
      numeric: true,
      render: (row) => (row.kind === "refund" ? `−${row.amount} ${row.currency}` : `${row.amount} ${row.currency}`),
    },
    { key: "method", header: "方式", render: (row) => methodLabels[row.method] ?? row.method },
    { key: "reference", header: "流水号", render: (row) => row.reference },
    { key: "notes", header: "备注", render: (row) => row.notes || "—" },
    {
      key: "actions",
      header: "操作",
      render: (row) => (
        <Link
          className="text-brand underline-offset-4 hover:underline"
          href={ledgerHref(row.id, row.kind === "refund" ? "PURCHASE_REFUND" : "PURCHASE_PAYMENT")}
        >
          转入总账
        </Link>
      ),
    },
  ];

  return <section aria-label="已登记采购付款记录" className="space-y-3">
    <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" aria-pressed={mode === "table"} onClick={() => setMode("table")}>表格记录</Button><Button type="button" size="sm" variant="secondary" aria-pressed={mode === "cards"} onClick={() => setMode("cards")}>卡片记录</Button></div>
    {mode === "table"
      ? <DataTable
          ariaLabel="已登记采购付款记录"
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          rowClassName={(row) => (row.kind === "refund" ? "bg-surface-muted/20" : undefined)}
        />
      : <div className="grid gap-3 sm:grid-cols-2">{payments.map(payment => <article key={payment.id} className="space-y-3 rounded border border-border p-3"><header className="flex justify-between gap-3 text-xs text-muted"><span>{methodLabels[payment.method] ?? payment.method}</span><time dateTime={payment.paidAt}>{payment.paidAt.slice(0, 10)}</time></header><div className="flex justify-between gap-3 text-sm font-semibold"><span className="break-all">{payment.reference}</span><span className="whitespace-nowrap tabular-nums">{payment.amount} {payment.currency}</span></div><p className="whitespace-pre-wrap text-xs text-muted">备注：{payment.notes || "—"}</p><Link className="inline-flex text-sm text-brand underline-offset-4 hover:underline" href={ledgerHref(payment.id)}>转入总账</Link>{payment.refunds.map(refund => <div key={refund.id} className="space-y-1 border-t border-border pt-2 text-sm"><div className="flex justify-between gap-3"><span className="text-muted">退款 · {refund.refundedAt.slice(0, 10)}</span><span className="whitespace-nowrap tabular-nums">−{refund.amount} {refund.currency}</span></div><p className="break-all text-xs text-muted">{refund.reference}</p><Link className="inline-flex text-sm text-brand underline-offset-4 hover:underline" href={ledgerHref(refund.id, "PURCHASE_REFUND")}>转入总账</Link></div>)}</article>)}</div>}
    <p className="text-xs text-muted">仅展示经复核确认的付款凭证。退款由关联原付款的独立复核流程登记，不直接删除或撤销已登记凭证。</p>
  </section>;
}
