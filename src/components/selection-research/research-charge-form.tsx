"use client";

import { useState } from "react";
import type { Run } from "@/lib/selection-research/types";
import { researchChargeCredits, type ResearchCharge } from "@/lib/selection-research/credits";

type Entry = { callId: string; charge: ResearchCharge; confirmation: string; expectedRevision: number };
/** Receipt entry is independent of request-outcome reconciliation and never issues market calls. */
export function ResearchChargeForm({ run, busy, save }: { run: Run; busy: boolean; save: (entry: Entry) => void }) {
  const calls = run.calls.filter(call => call.paid && call.dispatch !== "NOT_SENT");
  const [callId, setCallId] = useState("");
  const [unit, setUnit] = useState<ResearchCharge["unit"]>("CNY");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [rateDate, setRateDate] = useState("");
  const [rateSource, setRateSource] = useState("");
  const [receipt, setReceipt] = useState("");
  const [status, setStatus] = useState<ResearchCharge["status"]>("estimated");
  const charge: ResearchCharge = { amount: Number(amount), unit, cnyPerUnit: unit === "CNY" ? 1 : Number(rate), rateDate, rateSource, receipt, status };
  let credits: number | undefined;
  try { if (amount.trim()) credits = researchChargeCredits(charge); } catch { /* Incomplete form remains disabled. */ }
  if (!calls.length || ["COMPLETED", "CANCELLED"].includes(run.status)) return null;
  const control = "rounded border p-2";
  return <details className="rounded border p-3 text-sm"><summary>登记研究费用与积分凭据</summary>
    <p>1研究积分=¥0.01。填写原始费用及换算依据；未知价格保留待核实。此操作不充值、不扣账户余额，也不解除请求结果不明的暂停。</p>
    <form className="mt-2 flex flex-wrap gap-2" onSubmit={event => {
      event.preventDefault();
      if (credits === undefined || !calls.some(call => call.id === callId)) return;
      save({ callId, charge, expectedRevision: run.revision, confirmation: `在费用表单点击登记：${status === "confirmed" ? "确认凭据真实及换算依据" : "仅登记估算，不作为确认实耗"}` });
    }}>
      <label>请求<select aria-label="费用请求" className={control} required value={callId} onChange={event => setCallId(event.target.value)}><option value="">选择请求</option>{calls.map(call => <option key={call.id} value={call.id}>{call.tool} · {call.id}</option>)}</select></label>
      <label>原始单位<select aria-label="费用原始单位" className={control} value={unit} onChange={event => setUnit(event.target.value as ResearchCharge["unit"])}><option value="CNY">人民币</option><option value="USD">美元</option><option value="supplier_credits">供应商积分</option></select></label>
      <label>原始数量<input aria-label="费用原始数量" className={control} type="number" step="any" min={0} required value={amount} onChange={event => setAmount(event.target.value)} /></label>
      {unit !== "CNY" && <label>每原始单位人民币<input aria-label="费用换算率" className={control} type="number" step="any" min={0} required value={rate} onChange={event => setRate(event.target.value)} /></label>}
      <label>换算日期<input aria-label="费用换算日期" className={control} type="date" required value={rateDate} onChange={event => setRateDate(event.target.value)} /></label>
      <label>换算来源<input aria-label="费用换算来源" className={control} required maxLength={2000} value={rateSource} onChange={event => setRateSource(event.target.value)} /></label>
      <label>凭据或估算依据<input aria-label="费用凭据" className={control} required maxLength={2000} value={receipt} onChange={event => setReceipt(event.target.value)} /></label>
      <label>费用性质<select aria-label="费用性质" className={control} value={status} onChange={event => setStatus(event.target.value as ResearchCharge["status"])}><option value="estimated">估算</option><option value="confirmed">确认实耗</option></select></label>
      <p>折合：{credits === undefined ? "待填写完整依据" : `${credits}研究积分`}</p>
      <button className={control} disabled={busy || credits === undefined || !callId} type="submit">{status === "confirmed" ? "确认凭据并登记实耗" : "登记估算积分"}</button>
    </form>
  </details>;
}
