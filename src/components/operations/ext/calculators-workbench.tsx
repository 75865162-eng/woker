"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Kpis, Notice, Section, SelectField, Table, Tabs, bp, extPost, money, today, useExt } from "./kit";

type Scheme = { id: string; name: string; kind: string; marketplace: string; currency: string; revision: number; inputs: Record<string, string>; result: Record<string, unknown>; createdAt: string };
type FeeResult = {
  revenue: number; referralFee: number; fulfillmentFee: number; storageFee: number; totalFee: number; netProceeds: number;
  billableWeightOz: number; dimensionalWeightOz: number; sizeTier: string; breakdown: Array<{ label: string; amount: number; note: string }>;
};
type ProfitResult = FeeResult & { costTotal: number; profit: number; marginBp: number; roiBp: number; breakevenPrice: number; targetPrice: number };

const blank = {
  price: "29.99", shipping: "0", weightOz: "12", lengthIn: "10", widthIn: "8", heightIn: "2", oversize: "false",
  referralRateBp: "1500", storageDays: "30", unitCost: "6.5", inboundCost: "1.2", adCost: "2", otherCost: "0.4",
  returnRateBp: "300", targetMarginBp: "2000",
};

export function CalculatorsWorkbench() {
  const [tab, setTab] = useState<"PROFIT" | "FBA_FEE">("PROFIT");
  const [form, setForm] = useState({ ...blank });
  const [name, setName] = useState("");
  const [result, setResult] = useState<ProfitResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, reload } = useExt<{ items: Scheme[] }>("calc-schemes");

  const set = (key: keyof typeof blank) => (value: string) => setForm(current => ({ ...current, [key]: value }));

  async function quote() {
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = {
        price: form.price, shipping: form.shipping, weightOz: form.weightOz, lengthIn: form.lengthIn,
        widthIn: form.widthIn, heightIn: form.heightIn, oversize: form.oversize === "true",
        referralRateBp: form.referralRateBp, storageDays: form.storageDays, unitCost: form.unitCost,
        inboundCost: form.inboundCost, adCost: form.adCost, otherCost: form.otherCost,
        returnRateBp: form.returnRateBp, targetMarginBp: form.targetMarginBp,
      };
      const response = await extPost("quote", { kind: tab === "FBA_FEE" ? "fee" : "profit", ...payload });
      setResult(response.result as ProfitResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "测算失败。"); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!name.trim()) { setError("请先填写方案名称。"); return; }
    setBusy(true); setError("");
    try {
      await extPost("save-calc-scheme", {
        name, kind: tab, marketplace: "US", currency: "CNY", targetMarginBp: form.targetMarginBp,
        inputs: { ...form, oversize: form.oversize === "true" },
      });
      setNotice("测算方案已保存。"); setName(""); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); }
    finally { setBusy(false); }
  }

  async function remove(row: Scheme) {
    setBusy(true); setError("");
    try { await extPost("delete-calc-scheme", { id: row.id, revision: row.revision }); setNotice("方案已删除。"); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败。"); }
    finally { setBusy(false); }
  }

  function load(row: Scheme) {
    const inputs = row.inputs ?? {};
    const next = { ...blank };
    for (const key of Object.keys(blank) as Array<keyof typeof blank>) {
      const value = inputs[key];
      if (value !== undefined && value !== null) next[key] = String(value);
    }
    setForm(next); setTab(row.kind === "FBA_FEE" ? "FBA_FEE" : "PROFIT"); setName(row.name);
    setResult(row.result as unknown as ProfitResult); setNotice(`已载入方案「${row.name}」的入参快照。`);
  }

  return <div className="space-y-6">
    <Notice error={error} notice={notice} />
    <Tabs value={tab} onChange={value => setTab(value as "PROFIT" | "FBA_FEE")} tabs={[{ id: "PROFIT", label: "利润测算" }, { id: "FBA_FEE", label: "FBA 费用测算" }]} />

    <Section title="入参" description="费率卡默认取美国站标准尺寸公开费率，只作基线；实际费率以卖家后台为准，可在佣金比例与仓储天数上覆盖。">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="售价" value={form.price} onChange={set("price")} />
        <Field label="买家运费" value={form.shipping} onChange={set("shipping")} />
        <Field label="单件重量（oz）" value={form.weightOz} onChange={set("weightOz")} />
        <Field label="长（in）" value={form.lengthIn} onChange={set("lengthIn")} />
        <Field label="宽（in）" value={form.widthIn} onChange={set("widthIn")} />
        <Field label="高（in）" value={form.heightIn} onChange={set("heightIn")} />
        <SelectField label="尺寸类型" value={form.oversize} onChange={set("oversize")} options={[{ value: "false", label: "标准尺寸" }, { value: "true", label: "大件" }]} />
        <Field label="佣金比例（万分比）" value={form.referralRateBp} onChange={set("referralRateBp")} hint="1500 = 15%" />
        <Field label="仓储天数" value={form.storageDays} onChange={set("storageDays")} />
        {tab === "PROFIT" && <>
          <Field label="采购成本" value={form.unitCost} onChange={set("unitCost")} />
          <Field label="头程成本" value={form.inboundCost} onChange={set("inboundCost")} />
          <Field label="广告费" value={form.adCost} onChange={set("adCost")} />
          <Field label="其它费用" value={form.otherCost} onChange={set("otherCost")} />
          <Field label="退货率（万分比）" value={form.returnRateBp} onChange={set("returnRateBp")} />
          <Field label="目标毛利率（万分比）" value={form.targetMarginBp} onChange={set("targetMarginBp")} hint="2000 = 20%" />
        </>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button size="sm" disabled={busy} onClick={() => void quote()}>开始测算</Button>
        <input className="h-9 rounded border border-border bg-background px-2 text-sm" placeholder="方案名称（保存用）" value={name} onChange={event => setName(event.target.value)} />
        <Button size="sm" variant="ghost" disabled={busy || !result} onClick={() => void save()}>保存为方案</Button>
      </div>
    </Section>

    {result && <>
      <Kpis items={tab === "PROFIT" ? [
        { label: "净利 / 件", value: money(result.profit), tone: result.profit >= 0 ? "good" : "warn" },
        { label: "毛利率", value: bp(result.marginBp), tone: result.marginBp >= 0 ? "good" : "warn" },
        { label: "ROI", value: bp(result.roiBp) },
        { label: "保本价", value: money(result.breakevenPrice) },
      ] : [
        { label: "收入", value: money(result.revenue) },
        { label: "总费用", value: money(result.totalFee) },
        { label: "净收款", value: money(result.netProceeds) },
        { label: "计费重（oz）", value: String(result.billableWeightOz) },
      ]} />
      <Section title="费用拆解" description={`尺寸类型 ${result.sizeTier}；体积重 ${result.dimensionalWeightOz} oz。`}>
        <Table
          rows={result.breakdown.map(item => ({ ...item, id: item.label }))}
          empty="暂无费用项"
          columns={[
            { key: "label", label: "费用项" },
            { key: "amount", label: "金额", align: "right", render: row => money(row.amount) },
            { key: "note", label: "口径" },
          ]}
        />
        {tab === "PROFIT" && result.targetPrice > 0 && <p className="text-xs text-muted">
          按目标毛利率 {bp(Number(form.targetMarginBp))} 反算，需要定价 <span className="font-semibold text-foreground">{money(result.targetPrice)}</span>
          （当前保本价 {money(result.breakevenPrice)}）。
        </p>}
      </Section>
    </>}

    <Section title="已保存方案" description="保存的是入参快照与结果快照，改费率不影响历史方案。">
      <Table
        rows={data?.items ?? []}
        empty="还没有保存过方案。先在上面测算，再填名称保存。"
        columns={[
          { key: "name", label: "方案" },
          { key: "kind", label: "类型", render: row => row.kind === "FBA_FEE" ? "FBA 费用" : "利润" },
          { key: "createdAt", label: "保存时间", render: row => String(row.createdAt).slice(0, 10) },
          { key: "result", label: "结果", render: row => money((row.result as { profit?: number; totalFee?: number }).profit ?? (row.result as { totalFee?: number }).totalFee ?? 0) },
          { key: "ops", label: "操作", render: row => <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => load(row)}>载入</Button>
            <Button size="sm" variant="ghost" onClick={() => void remove(row)}>删除</Button>
          </div> },
        ]}
      />
    </Section>
    <p className="text-[11px] text-muted">测算日期基准 {today()}。费率与阈值是测算基线，不代替 Amazon 后台的实际计费。</p>
  </div>;
}
