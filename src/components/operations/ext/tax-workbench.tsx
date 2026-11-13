"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Field, Kpis, Notice, Section, SelectField, Table, Tabs, bp, extPost, money, statusLabel, today, useExt } from "./kit";

type Invoice = {
  id: string; country: string; taxType: string; invoiceNo: string; invoiceDate: string; counterparty: string;
  currency: string; taxableAmount: string; taxRateBp: number; taxAmount: string; direction: string;
  status: string; filingPeriod: string; revision: number;
};
type Period = { id: string; country: string; taxType: string; period: string; taxableAmount: string; taxAmount: string; status: string; filedAt: string | null; reference: string; revision: number };

const blank = {
  country: "DE", taxType: "VAT", invoiceNo: "", invoiceDate: today(), counterparty: "", currency: "EUR",
  taxableAmount: "", taxRateBp: "1900", direction: "OUTPUT", status: "DRAFT", filingPeriod: "",
};

export function TaxWorkbench() {
  const [tab, setTab] = useState<"INVOICE" | "PERIOD">("INVOICE");
  const [form, setForm] = useState({ ...blank });
  const [periodFilter, setPeriodFilter] = useState("");
  const [compute, setCompute] = useState({ country: "DE", taxType: "VAT", period: today().slice(0, 7) });
  const [editId, setEditId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const invoices = useExt<{ items: Invoice[]; summary: { INPUT: { taxable: number; tax: number }; OUTPUT: { taxable: number; tax: number }; payable: number } }>("tax-invoices", { period: periodFilter });
  const periods = useExt<{ items: Period[] }>("tax-periods");

  async function run(action: string, body: Record<string, unknown>, message: string, after: () => Promise<void> | void) {
    setBusy(true); setError(""); setNotice("");
    try { await extPost(action, body); setNotice(message); await after(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  const summary = invoices.data?.summary;
  return <div className="space-y-6">
    <Notice error={error || invoices.error || periods.error || ""} notice={notice} />
    <Tabs value={tab} onChange={value => setTab(value as "INVOICE" | "PERIOD")} tabs={[{ id: "INVOICE", label: "发票台账", count: invoices.data?.items.length }, { id: "PERIOD", label: "申报期", count: periods.data?.items.length }]} />

    {tab === "INVOICE" && <>
      <Kpis items={[
        { label: "销项税", value: money(summary?.OUTPUT.tax ?? 0), hint: `计税 ${money(summary?.OUTPUT.taxable ?? 0)}` },
        { label: "进项税", value: money(summary?.INPUT.tax ?? 0), hint: `计税 ${money(summary?.INPUT.taxable ?? 0)}` },
        { label: "应缴税额", value: money(summary?.payable ?? 0), tone: (summary?.payable ?? 0) > 0 ? "warn" : "good" },
        { label: "发票数", value: String(invoices.data?.items.length ?? 0) },
      ]} />

      <Section title={editId ? "编辑税务发票" : "登记税务发票"} description="税率为万分比（1900 = 19%），税额由计税金额 × 税率算出，不手填；申报期默认取开票月份。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="国家/地区" value={form.country} onChange={value => setForm(c => ({ ...c, country: value.toUpperCase() }))} hint="ISO 两位，如 DE" />
          <SelectField label="税种" value={form.taxType} onChange={value => setForm(c => ({ ...c, taxType: value }))} options={[{ value: "VAT", label: "VAT" }, { value: "GST", label: "GST" }, { value: "SALES_TAX", label: "销售税" }]} />
          <Field label="发票号" value={form.invoiceNo} onChange={value => setForm(c => ({ ...c, invoiceNo: value }))} />
          <Field label="开票日期" type="date" value={form.invoiceDate} onChange={value => setForm(c => ({ ...c, invoiceDate: value }))} />
          <Field label="交易对手" value={form.counterparty} onChange={value => setForm(c => ({ ...c, counterparty: value }))} />
          <Field label="币种" value={form.currency} onChange={value => setForm(c => ({ ...c, currency: value.toUpperCase() }))} />
          <Field label="计税金额" value={form.taxableAmount} onChange={value => setForm(c => ({ ...c, taxableAmount: value }))} />
          <Field label="税率（bp）" value={form.taxRateBp} onChange={value => setForm(c => ({ ...c, taxRateBp: value }))} />
          <SelectField label="进销项" value={form.direction} onChange={value => setForm(c => ({ ...c, direction: value }))} options={[{ value: "OUTPUT", label: "销项" }, { value: "INPUT", label: "进项" }]} />
          <SelectField label="状态" value={form.status} onChange={value => setForm(c => ({ ...c, status: value }))} options={[{ value: "DRAFT", label: "草稿" }, { value: "FILED", label: "已申报" }, { value: "PAID", label: "已缴税" }, { value: "VOID", label: "作废" }]} />
          <Field label="申报期" value={form.filingPeriod} onChange={value => setForm(c => ({ ...c, filingPeriod: value }))} placeholder={form.invoiceDate.slice(0, 7)} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void run("save-tax-invoice", { ...form, ...(editId ? { id: editId, revision: invoices.data?.items.find(row => row.id === editId)?.revision } : {}) }, editId ? "发票已更新。" : "发票已登记。", async () => { setForm({ ...blank }); setEditId(""); await invoices.reload(); })}>{editId ? "保存修改" : "登记发票"}</Button>
          {editId && <Button size="sm" variant="ghost" onClick={() => { setEditId(""); setForm({ ...blank }); }}>取消</Button>}
        </div>
      </Section>

      <Section title="发票台账" actions={<input className="h-8 rounded border border-border bg-background px-2 text-xs" placeholder="按申报期筛选，如 2026-11" value={periodFilter} onChange={event => setPeriodFilter(event.target.value)} />}>
        <Table
          rows={invoices.data?.items ?? []}
          empty="还没有税务发票。"
          columns={[
            { key: "invoiceDate", label: "开票日" },
            { key: "country", label: "国家" },
            { key: "invoiceNo", label: "发票号", render: row => <span className="font-mono">{row.invoiceNo}</span> },
            { key: "direction", label: "进销项", render: row => <Badge text={row.direction === "INPUT" ? "进项" : "销项"} tone={row.direction === "INPUT" ? "info" : "muted"} /> },
            { key: "taxableAmount", label: "计税金额", align: "right", render: row => `${money(row.taxableAmount)} ${row.currency}` },
            { key: "taxRateBp", label: "税率", align: "right", render: row => bp(row.taxRateBp) },
            { key: "taxAmount", label: "税额", align: "right", render: row => money(row.taxAmount) },
            { key: "filingPeriod", label: "申报期" },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "VOID" ? "warn" : row.status === "DRAFT" ? "muted" : "good"} /> },
            { key: "ops", label: "操作", render: row => <Button size="sm" variant="ghost" disabled={row.status === "VOID"} onClick={() => {
              setEditId(row.id);
              setForm({
                country: row.country, taxType: row.taxType, invoiceNo: row.invoiceNo, invoiceDate: row.invoiceDate,
                counterparty: row.counterparty, currency: row.currency, taxableAmount: String(Number(row.taxableAmount)),
                taxRateBp: String(row.taxRateBp), direction: row.direction, status: row.status, filingPeriod: row.filingPeriod,
              });
            }}>编辑</Button> },
          ]}
        />
      </Section>
    </>}

    {tab === "PERIOD" && <>
      <Section title="归集申报期" description="按国家 + 税种 + 申报期汇总有效发票，重复归集会刷新金额并留审计，不会凭空覆盖历史。">
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="国家/地区" value={compute.country} onChange={value => setCompute(c => ({ ...c, country: value.toUpperCase() }))} />
          <SelectField label="税种" value={compute.taxType} onChange={value => setCompute(c => ({ ...c, taxType: value }))} options={[{ value: "VAT", label: "VAT" }, { value: "GST", label: "GST" }, { value: "SALES_TAX", label: "销售税" }]} />
          <Field label="申报期" value={compute.period} onChange={value => setCompute(c => ({ ...c, period: value }))} placeholder="2026-11" />
          <div className="flex items-end"><Button size="sm" disabled={busy} onClick={() => void run("compute-tax-period", compute, "申报期已归集。", periods.reload)}>归集</Button></div>
        </div>
      </Section>
      <Section title="申报期清单">
        <Table
          rows={periods.data?.items ?? []}
          empty="还没有归集过申报期。"
          columns={[
            { key: "period", label: "申报期" },
            { key: "country", label: "国家" },
            { key: "taxType", label: "税种" },
            { key: "taxableAmount", label: "计税金额", align: "right", render: row => money(row.taxableAmount) },
            { key: "taxAmount", label: "税额", align: "right", render: row => money(row.taxAmount) },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "FILED" ? "good" : "info"} /> },
            { key: "reference", label: "申报凭证", render: row => row.reference || "—" },
            { key: "ops", label: "操作", render: row => row.status === "OPEN"
              ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("file-tax-period", { id: row.id, revision: row.revision, reference: `FILE-${row.period}-${row.country}` }, "申报期已标记申报。", periods.reload)}>标记已申报</Button>
              : <span className="text-muted">{row.filedAt ? row.filedAt.slice(0, 10) : "—"}</span> },
          ]}
        />
      </Section>
    </>}
  </div>;
}
