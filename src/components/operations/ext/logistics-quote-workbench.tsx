"use client";

import { useState } from "react";
import { WorkbenchPageTemplate } from "@/components/templates/page-templates";
import { Button } from "@/components/ui/button";
import { Badge, Field, Kpis, Notice, Section, SelectField, Table, Tabs, extPost, statusLabel, useExt } from "./kit";

type Channel = { id: string; code: string; name: string; mode: string; destination: string; enabled: boolean; revision: number };
type Rule = { id: string; channelId: string; matchKey: string; matchType: string; priority: number; enabled: boolean; revision: number };
type Quote = { id: string; number: string; requestId: string; channelId: string | null; carrier: string; currency: string; totalAmount: string; transitDays: number; validUntil: string | null; status: string; revision: number; channel?: { code: string; name: string; mode: string } | null };
type QuoteRequest = { id: string; number: string; status: string; origin: string; destination: string; preferredMode: string; pieces: number; weightKg: string; volumeCbm: string; needBy: string | null; notes: string; revision: number; quotes: Quote[] };
type PurchaseReturn = { id: string; number: string; supplierId: string; purchaseOrderId: string; reason: string; amount: string; currency: string; status: string; revision: number };
type ReportData = {
  summary: { orders: number; payments: number; invoices: number; plans: number; returns: number; paidAmount: number; invoiceAmount: number; returnedAmount: number; avgLeadDays: number | null };
  orderStatus: Record<string, number>;
  planStatus: Record<string, number>;
  paymentDetail: Array<{ id: string; amount: number; currency: string; createdAt: string }>;
  invoiceStatus: Record<string, number>;
};

const MODES = [{ value: "SEA", label: "海运" }, { value: "AIR", label: "空运" }, { value: "RAIL", label: "铁路" }, { value: "EXPRESS", label: "快递" }, { value: "TRUCK", label: "卡车" }];
const blankChannel = { code: "", name: "", mode: "SEA", destination: "" };
const blankRule = { channelId: "", matchKey: "", matchType: "SKU", priority: "100" };
const blankRequest = { origin: "", destination: "", preferredMode: "", pieces: "0", weightKg: "0", volumeCbm: "0", needBy: "" };
const blankQuote = { requestId: "", channelId: "", carrier: "", currency: "CNY", totalAmount: "0", transitDays: "0", validUntil: "" };
const blankReturn = { supplierId: "", purchaseOrderId: "", reason: "", amount: "0", currency: "CNY" };

export function LogisticsQuoteWorkbench() {
  const [tab, setTab] = useState<"CHANNEL" | "RULE" | "REQUEST" | "QUOTE" | "RETURN" | "REPORT">("REQUEST");
  const [channel, setChannel] = useState({ ...blankChannel });
  const [editChannelId, setEditChannelId] = useState("");
  const [rule, setRule] = useState({ ...blankRule });
  const [editRuleId, setEditRuleId] = useState("");
  const [request, setRequest] = useState({ ...blankRequest });
  const [editRequestId, setEditRequestId] = useState("");
  const [quote, setQuote] = useState({ ...blankQuote });
  const [editQuoteId, setEditQuoteId] = useState("");
  const [ret, setRet] = useState({ ...blankReturn });
  const [editReturnId, setEditReturnId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const channels = useExt<{ items: Channel[] }>("quote-channels");
  const rules = useExt<{ items: Rule[] }>("quote-rules");
  const requests = useExt<{ items: QuoteRequest[] }>("quote-requests");
  const quotes = useExt<{ items: Quote[] }>("quotes");
  const returns = useExt<{ items: PurchaseReturn[] }>("purchase-returns");
  const reports = useExt<ReportData>("procurement-reports");

  async function run(action: string, body: Record<string, unknown>, message: string, after: () => Promise<void> | void) {
    setBusy(true); setError(""); setSuccess("");
    try { await extPost(action, body); setSuccess(message); await after(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  const channelName = (id: string) => channels.data?.items.find(row => row.id === id)?.name ?? "—";
  const modeLabel = (value: string) => MODES.find(m => m.value === value)?.label ?? value;

  return <WorkbenchPageTemplate
    context={<Notice error={error || channels.error || rules.error || requests.error || quotes.error || returns.error || reports.error || ""} notice={success} />}
    kpis={<Kpis items={[
      { label: "询价单", value: String(requests.data?.items.length ?? 0) },
      { label: "报价单", value: String(quotes.data?.items.length ?? 0) },
      { label: "物流渠道", value: String(channels.data?.items.length ?? 0) },
      { label: "采购退货", value: String(returns.data?.items.length ?? 0) },
    ]} />}
    main={<div className="space-y-5">
      <Tabs value={tab} onChange={value => setTab(value as typeof tab)} tabs={[
        { id: "REQUEST", label: "集中询价", count: requests.data?.items.length },
        { id: "QUOTE", label: "报价单", count: quotes.data?.items.length },
        { id: "CHANNEL", label: "物流渠道", count: channels.data?.items.length },
        { id: "RULE", label: "关联设置", count: rules.data?.items.length },
        { id: "RETURN", label: "采购退货", count: returns.data?.items.length },
        { id: "REPORT", label: "采购报表" },
      ]} />

      {tab === "REQUEST" && <>
        <Section title={editRequestId ? "编辑询价单" : "新建集中询价"} description="货件事实（线路/重量/体积）只在草稿可改；提交后进入报价流程。金额不在此臆造。">
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="始发地" value={request.origin} onChange={value => setRequest(c => ({ ...c, origin: value }))} placeholder="深圳" />
            <Field label="目的地" value={request.destination} onChange={value => setRequest(c => ({ ...c, destination: value }))} placeholder="美国洛杉矶" />
            <SelectField label="期望方式" value={request.preferredMode} onChange={value => setRequest(c => ({ ...c, preferredMode: value }))} placeholder="不限" options={MODES} />
            <Field label="件数" value={request.pieces} onChange={value => setRequest(c => ({ ...c, pieces: value }))} />
            <Field label="重量（kg）" value={request.weightKg} onChange={value => setRequest(c => ({ ...c, weightKg: value }))} />
            <Field label="体积（CBM）" value={request.volumeCbm} onChange={value => setRequest(c => ({ ...c, volumeCbm: value }))} />
            <Field label="需求日期" value={request.needBy} onChange={value => setRequest(c => ({ ...c, needBy: value }))} type="date" />
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={busy} onClick={() => void run("save-quote-request", {
                ...request, pieces: Number(request.pieces || 0), weightKg: Number(request.weightKg || 0), volumeCbm: Number(request.volumeCbm || 0),
                ...(editRequestId ? { id: editRequestId, revision: requests.data?.items.find(row => row.id === editRequestId)?.revision } : {}),
              }, editRequestId ? "询价单已更新。" : "询价单已创建。", async () => { setRequest({ ...blankRequest }); setEditRequestId(""); await requests.reload(); })}>{editRequestId ? "保存" : "新建"}</Button>
              {editRequestId && <Button size="sm" variant="ghost" onClick={() => { setEditRequestId(""); setRequest({ ...blankRequest }); }}>取消</Button>}
            </div>
          </div>
        </Section>
        <Section title="询价单清单">
          <Table rows={requests.data?.items ?? []} empty="还没有询价单。" columns={[
            { key: "number", label: "单号", render: row => <span className="font-mono">{row.number}</span> },
            { key: "route", label: "线路", render: row => `${row.origin || "—"} → ${row.destination || "—"}` },
            { key: "cargo", label: "货量", render: row => `${row.pieces}件 / ${Number(row.weightKg).toFixed(2)}kg / ${Number(row.volumeCbm).toFixed(3)}CBM` },
            { key: "quotes", label: "报价数", align: "right", render: row => String(row.quotes?.length ?? 0) },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "ACCEPTED" ? "good" : row.status === "SUBMITTED" ? "info" : row.status === "CANCELLED" ? "muted" : "warn"} /> },
            { key: "ops", label: "操作", render: row => <div className="flex flex-wrap gap-1">
              {row.status === "DRAFT" && <Button size="sm" variant="ghost" onClick={() => {
                setEditRequestId(row.id);
                setRequest({ origin: row.origin, destination: row.destination, preferredMode: row.preferredMode, pieces: String(row.pieces), weightKg: row.weightKg, volumeCbm: row.volumeCbm, needBy: row.needBy ?? "" });
              }}>编辑</Button>}
              {row.status === "DRAFT" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-quote-request", { id: row.id, target: "SUBMITTED", revision: row.revision }, "询价已提交。", requests.reload)}>提交</Button>}
              {row.status === "QUOTED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-quote-request", { id: row.id, target: "ACCEPTED", revision: row.revision }, "已确认询价。", requests.reload)}>确认</Button>}
              {(row.status === "SUBMITTED" || row.status === "QUOTED") && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-quote-request", { id: row.id, target: "CLOSED", revision: row.revision }, "询价已关闭。", requests.reload)}>关闭</Button>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setQuote(current => ({ ...current, requestId: row.id })); setTab("QUOTE"); }}>去报价</Button>
            </div> },
          ]} />
        </Section>
      </>}

      {tab === "QUOTE" && <>
        <Section title={editQuoteId ? "编辑报价单" : "录入报价"} description="可为同一询价单登记多家承运商报价；接受某报价会自动拒绝同询价下其它报价并标记询价已采纳。">
          <div className="grid gap-2 sm:grid-cols-4">
            <SelectField label="关联询价单" value={quote.requestId} onChange={value => setQuote(c => ({ ...c, requestId: value }))} placeholder="选择询价单" options={(requests.data?.items ?? []).map(row => ({ value: row.id, label: row.number }))} />
            <SelectField label="物流渠道" value={quote.channelId} onChange={value => setQuote(c => ({ ...c, channelId: value }))} placeholder="可选" options={channels.data?.items.map(row => ({ value: row.id, label: row.name })) ?? []} />
            <Field label="承运商" value={quote.carrier} onChange={value => setQuote(c => ({ ...c, carrier: value }))} />
            <Field label="币种" value={quote.currency} onChange={value => setQuote(c => ({ ...c, currency: value.toUpperCase() }))} />
            <Field label="报价金额" value={quote.totalAmount} onChange={value => setQuote(c => ({ ...c, totalAmount: value }))} />
            <Field label="时效（天）" value={quote.transitDays} onChange={value => setQuote(c => ({ ...c, transitDays: value }))} />
            <Field label="有效期至" value={quote.validUntil} onChange={value => setQuote(c => ({ ...c, validUntil: value }))} type="date" />
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={busy || !quote.requestId} onClick={() => void run("save-quote", {
                ...quote, channelId: quote.channelId || null, totalAmount: Number(quote.totalAmount || 0), transitDays: Number(quote.transitDays || 0),
                ...(editQuoteId ? { id: editQuoteId, revision: quotes.data?.items.find(row => row.id === editQuoteId)?.revision } : {}),
              }, editQuoteId ? "报价已更新。" : "报价已录入。", async () => { setQuote({ ...blankQuote }); setEditQuoteId(""); await quotes.reload(); })}>{editQuoteId ? "保存" : "录入"}</Button>
              {editQuoteId && <Button size="sm" variant="ghost" onClick={() => { setEditQuoteId(""); setQuote({ ...blankQuote }); }}>取消</Button>}
            </div>
          </div>
        </Section>
        <Section title="报价单清单">
          <Table rows={quotes.data?.items ?? []} empty="还没有报价。" columns={[
            { key: "number", label: "报价单号", render: row => <span className="font-mono">{row.number}</span> },
            { key: "carrier", label: "承运商", render: row => row.carrier || row.channel?.name || "—" },
            { key: "mode", label: "方式", render: row => row.channel ? modeLabel(row.channel.mode) : "—" },
            { key: "amount", label: "报价", align: "right", render: row => `${row.currency} ${Number(row.totalAmount).toFixed(2)}` },
            { key: "transitDays", label: "时效", align: "right", render: row => `${row.transitDays}天` },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "ACCEPTED" ? "good" : row.status === "REJECTED" ? "muted" : "info"} /> },
            { key: "ops", label: "操作", render: row => <div className="flex flex-wrap gap-1">
              {row.status === "DRAFT" && <><Button size="sm" variant="ghost" onClick={() => {
                setEditQuoteId(row.id);
                setQuote({ requestId: row.requestId, channelId: row.channelId ?? "", carrier: row.carrier, currency: row.currency, totalAmount: row.totalAmount, transitDays: String(row.transitDays), validUntil: row.validUntil ?? "" });
              }}>编辑</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-quote", { id: row.id, target: "SUBMITTED", revision: row.revision }, "报价已提交。", quotes.reload)}>提交</Button></>}
              {row.status === "SUBMITTED" && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-quote", { id: row.id, target: "ACCEPTED", revision: row.revision }, "已接受该报价。", async () => { await quotes.reload(); await requests.reload(); })}>接受</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-quote", { id: row.id, target: "REJECTED", revision: row.revision }, "已拒绝该报价。", quotes.reload)}>拒绝</Button></>}
            </div> },
          ]} />
        </Section>
      </>}

      {tab === "CHANNEL" && <>
        <Section title={editChannelId ? "编辑物流渠道" : "新建物流渠道"} description="头程方式、目的地与计费规则快照；计费规则为只读证据，不自动改价。">
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="渠道编码" value={channel.code} onChange={value => setChannel(c => ({ ...c, code: value.toUpperCase() }))} placeholder="SEA-US-LA" />
            <Field label="渠道名称" value={channel.name} onChange={value => setChannel(c => ({ ...c, name: value }))} />
            <SelectField label="头程方式" value={channel.mode} onChange={value => setChannel(c => ({ ...c, mode: value }))} options={MODES} />
            <Field label="目的地" value={channel.destination} onChange={value => setChannel(c => ({ ...c, destination: value }))} />
            <div className="flex items-end">
              <Button size="sm" disabled={busy} onClick={() => void run("save-quote-channel", {
                ...channel,
                ...(editChannelId ? { id: editChannelId, revision: channels.data?.items.find(row => row.id === editChannelId)?.revision } : {}),
              }, editChannelId ? "渠道已更新。" : "渠道已创建。", async () => { setChannel({ ...blankChannel }); setEditChannelId(""); await channels.reload(); })}>{editChannelId ? "保存" : "新建"}</Button>
            </div>
          </div>
          {editChannelId && <Button size="sm" variant="ghost" onClick={() => { setEditChannelId(""); setChannel({ ...blankChannel }); }}>取消编辑</Button>}
        </Section>
        <Section title="渠道清单">
          <Table rows={channels.data?.items ?? []} empty="还没有物流渠道。" columns={[
            { key: "code", label: "编码", render: row => <span className="font-mono">{row.code}</span> },
            { key: "name", label: "名称" },
            { key: "mode", label: "方式", render: row => modeLabel(row.mode) },
            { key: "destination", label: "目的地", render: row => row.destination || "—" },
            { key: "enabled", label: "状态", render: row => <Badge text={row.enabled ? "启用" : "停用"} tone={row.enabled ? "good" : "muted"} /> },
            { key: "ops", label: "操作", render: row => <Button size="sm" variant="ghost" onClick={() => {
              setEditChannelId(row.id);
              setChannel({ code: row.code, name: row.name, mode: row.mode, destination: row.destination });
            }}>编辑</Button> },
          ]} />
        </Section>
      </>}

      {tab === "RULE" && <>
        <Section title={editRuleId ? "编辑关联设置" : "新建关联设置"} description="SKU 前缀/仓库/目的地 → 渠道的匹配优先级；数字越小越优先。">
          <div className="grid gap-2 sm:grid-cols-5">
            <SelectField label="物流渠道" value={rule.channelId} onChange={value => setRule(c => ({ ...c, channelId: value }))} placeholder="选择渠道" options={channels.data?.items.map(row => ({ value: row.id, label: row.name })) ?? []} />
            <SelectField label="匹配类型" value={rule.matchType} onChange={value => setRule(c => ({ ...c, matchType: value }))} options={[{ value: "SKU", label: "SKU 前缀" }, { value: "WAREHOUSE", label: "仓库" }, { value: "DESTINATION", label: "目的地" }]} />
            <Field label="匹配值" value={rule.matchKey} onChange={value => setRule(c => ({ ...c, matchKey: value }))} placeholder="空为通配" />
            <Field label="优先级" value={rule.priority} onChange={value => setRule(c => ({ ...c, priority: value }))} />
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={busy || !rule.channelId} onClick={() => void run("save-quote-rule", {
                ...rule, priority: Number(rule.priority || 100),
                ...(editRuleId ? { id: editRuleId, revision: rules.data?.items.find(row => row.id === editRuleId)?.revision } : {}),
              }, editRuleId ? "规则已更新。" : "规则已创建。", async () => { setRule({ ...blankRule }); setEditRuleId(""); await rules.reload(); })}>{editRuleId ? "保存" : "新建"}</Button>
              {editRuleId && <Button size="sm" variant="ghost" onClick={() => { setEditRuleId(""); setRule({ ...blankRule }); }}>取消</Button>}
            </div>
          </div>
        </Section>
        <Section title="关联设置清单">
          <Table rows={rules.data?.items ?? []} empty="还没有关联设置。" columns={[
            { key: "channel", label: "渠道", render: row => channelName(row.channelId) },
            { key: "matchType", label: "类型" },
            { key: "matchKey", label: "匹配值", render: row => row.matchKey || "通配" },
            { key: "priority", label: "优先级", align: "right" },
            { key: "enabled", label: "状态", render: row => <Badge text={row.enabled ? "启用" : "停用"} tone={row.enabled ? "good" : "muted"} /> },
            { key: "ops", label: "操作", render: row => <Button size="sm" variant="ghost" onClick={() => {
              setEditRuleId(row.id);
              setRule({ channelId: row.channelId, matchKey: row.matchKey, matchType: row.matchType, priority: String(row.priority) });
            }}>编辑</Button> },
          ]} />
        </Section>
      </>}

      {tab === "RETURN" && <>
        <Section title={editReturnId ? "编辑采购退货单" : "新建采购退货单"} description="对标 wimoor 采购换货/退货；仅登记事实与审批状态，不自动冲减库存与应付。">
          <div className="grid gap-2 sm:grid-cols-5">
            <Field label="供应商 ID" value={ret.supplierId} onChange={value => setRet(c => ({ ...c, supplierId: value }))} />
            <Field label="采购单号/ID" value={ret.purchaseOrderId} onChange={value => setRet(c => ({ ...c, purchaseOrderId: value }))} />
            <Field label="退货金额" value={ret.amount} onChange={value => setRet(c => ({ ...c, amount: value }))} />
            <Field label="币种" value={ret.currency} onChange={value => setRet(c => ({ ...c, currency: value.toUpperCase() }))} />
            <Field label="退货原因" value={ret.reason} onChange={value => setRet(c => ({ ...c, reason: value }))} />
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button size="sm" disabled={busy} onClick={() => void run("save-purchase-return", {
                ...ret, amount: Number(ret.amount || 0),
                ...(editReturnId ? { id: editReturnId, revision: returns.data?.items.find(row => row.id === editReturnId)?.revision } : {}),
              }, editReturnId ? "退货单已更新。" : "退货单已创建。", async () => { setRet({ ...blankReturn }); setEditReturnId(""); await returns.reload(); })}>{editReturnId ? "保存" : "新建"}</Button>
              {editReturnId && <Button size="sm" variant="ghost" onClick={() => { setEditReturnId(""); setRet({ ...blankReturn }); }}>取消</Button>}
            </div>
          </div>
        </Section>
        <Section title="退货单清单">
          <Table rows={returns.data?.items ?? []} empty="还没有退货单。" columns={[
            { key: "number", label: "单号", render: row => <span className="font-mono">{row.number}</span> },
            { key: "supplierId", label: "供应商", render: row => row.supplierId || "—" },
            { key: "reason", label: "原因", render: row => row.reason || "—" },
            { key: "amount", label: "金额", align: "right", render: row => `${row.currency} ${Number(row.amount).toFixed(2)}` },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "CLOSED" ? "good" : row.status === "CANCELLED" ? "muted" : "info"} /> },
            { key: "ops", label: "操作", render: row => <div className="flex flex-wrap gap-1">
              {row.status === "DRAFT" && <><Button size="sm" variant="ghost" onClick={() => {
                setEditReturnId(row.id);
                setRet({ supplierId: row.supplierId, purchaseOrderId: row.purchaseOrderId, reason: row.reason, amount: row.amount, currency: row.currency });
              }}>编辑</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-purchase-return", { id: row.id, target: "SUBMITTED", revision: row.revision }, "退货单已提交。", returns.reload)}>提交</Button></>}
              {row.status === "SUBMITTED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-purchase-return", { id: row.id, target: "APPROVED", revision: row.revision }, "退货单已批准。", returns.reload)}>批准</Button>}
              {row.status === "APPROVED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-purchase-return", { id: row.id, target: "SHIPPED", revision: row.revision }, "已标记发货。", returns.reload)}>发货</Button>}
              {row.status === "SHIPPED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-purchase-return", { id: row.id, target: "CLOSED", revision: row.revision }, "退货单已关闭。", returns.reload)}>关闭</Button>}
            </div> },
          ]} />
        </Section>
      </>}

      {tab === "REPORT" && <>
        <Section title="采购 5 类只读报表" description="全部基于现有采购事实表汇总；缺失口径保留 null，不造数、不改事实源。">
          <Kpis items={[
            { label: "采购单", value: String(reports.data?.summary.orders ?? 0) },
            { label: "付款笔数", value: String(reports.data?.summary.payments ?? 0), hint: <span>合计 {Number(reports.data?.summary.paidAmount ?? 0).toFixed(2)}</span> },
            { label: "发票金额", value: Number(reports.data?.summary.invoiceAmount ?? 0).toFixed(2) },
            { label: "平均采购时效", value: reports.data?.summary.avgLeadDays === null || reports.data?.summary.avgLeadDays === undefined ? "—" : `${reports.data.summary.avgLeadDays}天` },
          ]} />
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold">采购单状态分布</h3>
              <Table rows={Object.entries(reports.data?.orderStatus ?? {}).map(([status, count]) => ({ id: status, status, count }))} empty="暂无采购单。" columns={[
                { key: "status", label: "状态", render: row => statusLabel(row.status) },
                { key: "count", label: "数量", align: "right" },
              ]} />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold">发票匹配状态</h3>
              <Table rows={Object.entries(reports.data?.invoiceStatus ?? {}).map(([status, count]) => ({ id: status, status, count }))} empty="暂无发票。" columns={[
                { key: "status", label: "匹配状态", render: row => statusLabel(row.status) },
                { key: "count", label: "数量", align: "right" },
              ]} />
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold">采购付款明细</h3>
            <Table rows={reports.data?.paymentDetail ?? []} empty="暂无付款记录。" columns={[
              { key: "createdAt", label: "付款日期" },
              { key: "currency", label: "币种" },
              { key: "amount", label: "金额", align: "right", render: row => Number(row.amount).toFixed(2) },
            ]} />
          </div>
        </Section>
      </>}
    </div>} />;
}
