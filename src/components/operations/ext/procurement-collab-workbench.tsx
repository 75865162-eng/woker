"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AreaField, Badge, Field, Kpis, Notice, Section, SelectField, Table, Tabs, today, useExt, extPost, money, statusLabel } from "./kit";

type Supplier = { id: string; name: string };
type PaymentRequest = { id: string; number: string; supplierId: string; purchaseOrderId: string; currency: string; amount: string; dueDate: string; purpose: string; status: string; createdBy: string; revision: number };
type ExchangeOrder = { id: string; number: string; supplierId: string; purchaseOrderId: string; reason: string; status: string; lineCount: number; expectedAt: string | null; revision: number; lines: Array<{ sellerSku: string; quantity: number; replacementQty: number; note: string }> };
type Quotation = { id: string; number: string; supplierId: string; productRecordId: string; sellerSku: string; currency: string; unitPrice: string; moq: number; leadTimeDays: number; validUntil: string | null; status: string; revision: number };
type Best = { key: string; quotation: { id: string; unitPrice: number; leadTimeDays: number; number: string; supplierId: string } | null };

const blankPay = { supplierId: "", purchaseOrderId: "", currency: "CNY", amount: "", dueDate: today(), purpose: "" };
const blankExchange = { supplierId: "", purchaseOrderId: "", reason: "", expectedAt: "", lines: "A-SKU-01,10,10,外箱破损\nB-SKU-02,4,4,颜色错发" };
const blankQuote = { supplierId: "", productRecordId: "", sellerSku: "", currency: "CNY", unitPrice: "", moq: "1", leadTimeDays: "15", validUntil: "" };

export function ProcurementCollabWorkbench() {
  const [tab, setTab] = useState<"PAY" | "EXCHANGE" | "QUOTE">("PAY");
  const [pay, setPay] = useState({ ...blankPay });
  const [exchange, setExchange] = useState({ ...blankExchange });
  const [quote, setQuote] = useState({ ...blankQuote });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const options = useExt<{ suppliers: Supplier[]; products: Array<{ id: string; sku: string; asin: string }> }>("options");
  const payments = useExt<{ items: PaymentRequest[] }>("payment-requests");
  const exchanges = useExt<{ items: ExchangeOrder[] }>("exchange-orders");
  const quotations = useExt<{ items: Quotation[]; best: Best[] }>("quotations");

  const supplierName = (id: string) => options.data?.suppliers.find(row => row.id === id)?.name ?? id.slice(0, 8);

  async function run(action: string, body: Record<string, unknown>, message: string, after: () => Promise<void> | void) {
    setBusy(true); setError(""); setNotice("");
    try { await extPost(action, body); setNotice(message); await after(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  function parseExchangeLines(text: string) {
    return text.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
      const [sellerSku, quantity, replacementQty, note] = line.split(",").map(item => item.trim());
      return { sellerSku, quantity: Number(quantity || 0), replacementQty: Number(replacementQty || quantity || 0), note: note ?? "" };
    });
  }

  return <div className="space-y-6">
    <Notice error={error || payments.error || exchanges.error || quotations.error || ""} notice={notice} />
    <Kpis items={[
      { label: "待审请款", value: String((payments.data?.items ?? []).filter(row => row.status === "SUBMITTED").length), hint: "提交后进入审批" },
      { label: "待付款", value: String((payments.data?.items ?? []).filter(row => row.status === "APPROVED").length) },
      { label: "换货中", value: String((exchanges.data?.items ?? []).filter(row => ["SUBMITTED", "APPROVED", "SHIPPED"].includes(row.status)).length) },
      { label: "有效报价", value: String((quotations.data?.items ?? []).filter(row => row.status === "ACTIVE").length) },
    ]} />
    <Tabs value={tab} onChange={value => setTab(value as "PAY" | "EXCHANGE" | "QUOTE")} tabs={[{ id: "PAY", label: "请款单" }, { id: "EXCHANGE", label: "换货单" }, { id: "QUOTE", label: "供应商报价" }]} />

    {tab === "PAY" && <>
      <Section title="新建请款单" description="请款独立于付款登记：提交→审批→付款三段流转，申请人不能审批自己提交的单据。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SelectField label="供应商" value={pay.supplierId} onChange={value => setPay(c => ({ ...c, supplierId: value }))} placeholder="选择供应商" options={(options.data?.suppliers ?? []).map(row => ({ value: row.id, label: row.name }))} />
          <Field label="关联采购单号" value={pay.purchaseOrderId} onChange={value => setPay(c => ({ ...c, purchaseOrderId: value }))} hint="选填" />
          <Field label="币种" value={pay.currency} onChange={value => setPay(c => ({ ...c, currency: value }))} />
          <Field label="请款金额" value={pay.amount} onChange={value => setPay(c => ({ ...c, amount: value }))} />
          <Field label="期望付款日" type="date" value={pay.dueDate} onChange={value => setPay(c => ({ ...c, dueDate: value }))} />
        </div>
        <AreaField label="请款事由" value={pay.purpose} onChange={value => setPay(c => ({ ...c, purpose: value }))} />
        <Button size="sm" disabled={busy || !pay.supplierId} onClick={() => void run("save-payment-request", pay, "请款单已创建（草稿）。", async () => { setPay({ ...blankPay }); await payments.reload(); })}>创建请款单</Button>
      </Section>
      <Section title="请款单清单">
        <Table
          rows={payments.data?.items ?? []}
          empty="还没有请款单。"
          columns={[
            { key: "number", label: "单号", render: row => <span className="font-mono">{row.number}</span> },
            { key: "supplierId", label: "供应商", render: row => supplierName(row.supplierId) },
            { key: "amount", label: "金额", align: "right", render: row => `${money(row.amount)} ${row.currency}` },
            { key: "dueDate", label: "期望付款日" },
            { key: "purpose", label: "事由", render: row => <span className="block max-w-[240px] truncate" title={row.purpose}>{row.purpose}</span> },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "SUBMITTED" ? "info" : row.status === "APPROVED" ? "good" : row.status === "REJECTED" ? "warn" : "muted"} /> },
            { key: "ops", label: "流转", render: row => <div className="flex flex-wrap gap-1">
              {row.status === "DRAFT" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-payment-request", { id: row.id, revision: row.revision, action: "submit" }, "请款单已提交。", payments.reload)}>提交</Button>}
              {row.status === "SUBMITTED" && <>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-payment-request", { id: row.id, revision: row.revision, action: "approve" }, "请款单已批准。", payments.reload)}>批准</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-payment-request", { id: row.id, revision: row.revision, action: "reject", reason: "金额与采购单不符" }, "请款单已驳回。", payments.reload)}>驳回</Button>
              </>}
              {row.status === "APPROVED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-payment-request", { id: row.id, revision: row.revision, action: "pay" }, "已标记为已付款。", payments.reload)}>登记付款</Button>}
            </div> },
          ]}
        />
      </Section>
    </>}

    {tab === "EXCHANGE" && <>
      <Section title="新建换货单" description="每行格式：SKU,换货数量,补发数量,备注（逗号分隔）。提交后走审批，审批通过才允许发货。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <SelectField label="供应商" value={exchange.supplierId} onChange={value => setExchange(c => ({ ...c, supplierId: value }))} placeholder="选择供应商" options={(options.data?.suppliers ?? []).map(row => ({ value: row.id, label: row.name }))} />
          <Field label="关联采购单号" value={exchange.purchaseOrderId} onChange={value => setExchange(c => ({ ...c, purchaseOrderId: value }))} hint="选填" />
          <Field label="换货原因" value={exchange.reason} onChange={value => setExchange(c => ({ ...c, reason: value }))} />
          <Field label="预计换回日" type="date" value={exchange.expectedAt} onChange={value => setExchange(c => ({ ...c, expectedAt: value }))} />
        </div>
        <AreaField label="换货明细（SKU,换货数量,补发数量,备注）" value={exchange.lines} onChange={value => setExchange(c => ({ ...c, lines: value }))} />
        <Button size="sm" disabled={busy || !exchange.supplierId} onClick={() => void run("save-exchange-order", { ...exchange, lines: parseExchangeLines(exchange.lines), expectedAt: exchange.expectedAt || null }, "换货单已创建（草稿）。", async () => { setExchange({ ...blankExchange }); await exchanges.reload(); })}>创建换货单</Button>
      </Section>
      <Section title="换货单清单">
        <Table
          rows={exchanges.data?.items ?? []}
          empty="还没有换货单。"
          columns={[
            { key: "number", label: "单号", render: row => <span className="font-mono">{row.number}</span> },
            { key: "supplierId", label: "供应商", render: row => supplierName(row.supplierId) },
            { key: "lineCount", label: "行数", align: "right" },
            { key: "reason", label: "原因", render: row => <span className="block max-w-[220px] truncate" title={row.reason}>{row.reason}</span> },
            { key: "expectedAt", label: "预计换回", render: row => row.expectedAt ?? "—" },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "APPROVED" ? "good" : row.status === "DRAFT" ? "muted" : "info"} /> },
            { key: "ops", label: "流转", render: row => <div className="flex flex-wrap gap-1">
              {row.status === "DRAFT" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-exchange-order", { id: row.id, revision: row.revision, action: "submit" }, "换货单已提交。", exchanges.reload)}>提交</Button>}
              {row.status === "SUBMITTED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-exchange-order", { id: row.id, revision: row.revision, action: "approve" }, "换货单已批准。", exchanges.reload)}>批准</Button>}
              {row.status === "APPROVED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-exchange-order", { id: row.id, revision: row.revision, action: "ship" }, "已标记为已发出。", exchanges.reload)}>标记发出</Button>}
              {row.status === "SHIPPED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-exchange-order", { id: row.id, revision: row.revision, action: "close" }, "换货单已关闭。", exchanges.reload)}>关闭</Button>}
            </div> },
          ]}
        />
      </Section>
    </>}

    {tab === "QUOTE" && <>
      <Section title="录入供应商报价" description="同一 SKU 多方报价后在下方比价，选定即锁定当次单价、MOQ 与交期；选定不会自动生成采购单。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SelectField label="供应商" value={quote.supplierId} onChange={value => setQuote(c => ({ ...c, supplierId: value }))} placeholder="选择供应商" options={(options.data?.suppliers ?? []).map(row => ({ value: row.id, label: row.name }))} />
          <SelectField label="商品" value={quote.productRecordId} onChange={value => {
            const product = options.data?.products.find(row => row.id === value);
            setQuote(c => ({ ...c, productRecordId: value, sellerSku: product?.sku ?? c.sellerSku }));
          }} placeholder="选择商品" options={(options.data?.products ?? []).map(row => ({ value: row.id, label: `${row.sku}${row.asin ? ` · ${row.asin}` : ""}` }))} />
          <Field label="SKU" value={quote.sellerSku} onChange={value => setQuote(c => ({ ...c, sellerSku: value }))} />
          <Field label="单价" value={quote.unitPrice} onChange={value => setQuote(c => ({ ...c, unitPrice: value }))} />
          <Field label="MOQ" value={quote.moq} onChange={value => setQuote(c => ({ ...c, moq: value }))} />
          <Field label="交期（天）" value={quote.leadTimeDays} onChange={value => setQuote(c => ({ ...c, leadTimeDays: value }))} />
          <Field label="有效期至" type="date" value={quote.validUntil} onChange={value => setQuote(c => ({ ...c, validUntil: value }))} />
          <Field label="币种" value={quote.currency} onChange={value => setQuote(c => ({ ...c, currency: value }))} />
        </div>
        <Button size="sm" disabled={busy || !quote.supplierId || !quote.unitPrice} onClick={() => void run("save-quotation", { ...quote, validUntil: quote.validUntil || null }, "报价单已录入。", async () => { setQuote({ ...blankQuote }); await quotations.reload(); })}>录入报价</Button>
      </Section>
      <Section title="报价清单与比价">
        <Table
          rows={quotations.data?.items ?? []}
          empty="还没有供应商报价。"
          columns={[
            { key: "number", label: "报价单号", render: row => <span className="font-mono">{row.number}</span> },
            { key: "sellerSku", label: "SKU" },
            { key: "supplierId", label: "供应商", render: row => supplierName(row.supplierId) },
            { key: "unitPrice", label: "单价", align: "right", render: row => `${money(row.unitPrice)} ${row.currency}` },
            { key: "moq", label: "MOQ", align: "right" },
            { key: "leadTimeDays", label: "交期", align: "right", render: row => `${row.leadTimeDays} 天` },
            { key: "validUntil", label: "有效期", render: row => row.validUntil ?? "—" },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "SELECTED" ? "good" : row.status === "EXPIRED" ? "muted" : "info"} /> },
            { key: "ops", label: "操作", render: row => row.status === "ACTIVE"
              ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("select-quotation", { id: row.id }, "已选定该报价。", quotations.reload)}>选定</Button>
              : <span className="text-muted">—</span> },
          ]}
        />
        {(quotations.data?.best ?? []).length > 0 && <div className="space-y-1 rounded border border-border p-3 text-xs">
          <p className="font-semibold">比价结论（同 SKU 取单价最低，价同取交期最短）</p>
          {(quotations.data?.best ?? []).map(item => <p key={item.key} className="text-muted">
            {item.key.slice(0, 24)} → {item.quotation ? `${item.quotation.number} · ${money(item.quotation.unitPrice)} · ${item.quotation.leadTimeDays} 天 · ${supplierName(item.quotation.supplierId)}` : "无可比报价"}
          </p>)}
        </div>}
      </Section>
    </>}
  </div>;
}
