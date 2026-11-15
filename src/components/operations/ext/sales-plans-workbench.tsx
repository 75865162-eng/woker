"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Field, Kpis, Notice, Section, SelectField, Table, extPost, money, statusLabel, today, useExt } from "./kit";

type PlanRow = { id: string; name: string; marketplace: string; periodStart: string; periodEnd: string; status: string; lineCount: number; targetQty: number; targetRevenue: number; forecastQty: number; revision: number };
type PlanDetail = {
  plan: { id: string; name: string; marketplace: string; currency: string; periodType: string; periodStart: string; periodEnd: string; status: string; revision: number; forecastWindowDays: number; seasonalityBp: number; notes: string };
  lines: Array<{ id: string; sellerSku: string; asin: string; targetQty: number; targetRevenue: string; unitCost: string; historyDailyAvg: string; forecastQty: number; actualQty: number; actualRevenue: number; completionBp: number; gap: number }>;
  totals: { targetQty: number; actualQty: number; forecastQty: number };
};
type LineDraft = { sellerSku: string; asin: string; targetQty: string; targetRevenue: string; unitCost: string };

const emptyLine: LineDraft = { sellerSku: "", asin: "", targetQty: "0", targetRevenue: "0", unitCost: "0" };
const monthStart = () => today().slice(0, 8) + "01";
const monthEnd = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

export function SalesPlansWorkbench() {
  const [selected, setSelected] = useState("");
  const [header, setHeader] = useState({ name: "", marketplace: "US", currency: "CNY", periodType: "MONTH", periodStart: monthStart(), periodEnd: monthEnd(), forecastWindowDays: "90", seasonalityBp: "10000", notes: "" });
  const [lines, setLines] = useState<LineDraft[]>([{ ...emptyLine }]);
  const [editing, setEditing] = useState<{ id: string; revision: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const plans = useExt<{ items: PlanRow[] }>("sales-plans");
  const detail = useExt<{ plan: PlanDetail["plan"]; lines: PlanDetail["lines"]; totals: PlanDetail["totals"] }>("sales-plan", { id: selected }, Boolean(selected));
  const options = useExt<{ products: Array<{ id: string; sku: string; asin: string; purchasePrice: number }> }>("options");

  const days = useMemo(() => {
    const start = Date.parse(`${header.periodStart}T00:00:00Z`);
    const end = Date.parse(`${header.periodEnd}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
    return Math.round((end - start) / 86_400_000) + 1;
  }, [header.periodStart, header.periodEnd]);

  async function run(action: string, body: Record<string, unknown>, message: string, after: () => Promise<void> | void) {
    setBusy(true); setError(""); setNotice("");
    try { await extPost(action, body); setNotice(message); await after(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  function save() {
    const payloadLines = lines.filter(line => line.sellerSku.trim()).map(line => ({
      sellerSku: line.sellerSku.trim(), asin: line.asin.trim(),
      targetQty: Number(line.targetQty || 0), targetRevenue: Number(line.targetRevenue || 0), unitCost: Number(line.unitCost || 0),
    }));
    if (!payloadLines.length) { setError("至少填写一行 SKU 目标。"); return; }
    void run("save-sales-plan", {
      ...header, ...(editing ? { id: editing.id, revision: editing.revision } : {}),
      periodType: header.periodType, forecastWindowDays: Number(header.forecastWindowDays), seasonalityBp: Number(header.seasonalityBp),
      lines: payloadLines,
    }, editing ? "销售计划已更新。" : "销售计划已创建。", async () => {
      setEditing(null); setLines([{ ...emptyLine }]); setHeader(current => ({ ...current, name: "" }));
      const response = await plans.reload() as unknown;
      void response;
    });
  }

  function loadPlan(row: PlanRow) {
    setSelected(row.id);
    setEditing({ id: row.id, revision: row.revision });
    setHeader({
      name: row.name, marketplace: row.marketplace, currency: "CNY", periodType: "MONTH",
      periodStart: row.periodStart, periodEnd: row.periodEnd, forecastWindowDays: "90", seasonalityBp: "10000", notes: "",
    });
    setNotice(`已选择「${row.name}」，行明细在下方区域加载后可编辑。`);
  }

  return <div className="space-y-6">
    <Notice error={error || plans.error || detail.error || ""} notice={notice} />
    <Kpis items={[
      { label: "计划数", value: String(plans.data?.items.length ?? 0) },
      { label: "在行 SKU", value: String((plans.data?.items ?? []).reduce((sum, row) => sum + row.lineCount, 0)) },
      { label: "目标销量合计", value: String((plans.data?.items ?? []).reduce((sum, row) => sum + row.targetQty, 0)) },
      { label: "预测销量合计", value: String((plans.data?.items ?? []).reduce((sum, row) => sum + row.forecastQty, 0)) },
    ]} />

    <Section title={editing ? "编辑销售计划" : "新建销售计划"} description="预测取历史日均销量 × 计划天数 × 季节系数；实际销量取订单事实，两者都不允许手填覆盖。">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="计划名称" value={header.name} onChange={value => setHeader(c => ({ ...c, name: value }))} placeholder="2026-12 北美主推" />
        <SelectField label="站点" value={header.marketplace} onChange={value => setHeader(c => ({ ...c, marketplace: value }))} options={["US", "CA", "MX", "UK", "DE", "FR", "IT", "ES", "JP"].map(value => ({ value, label: value }))} />
        <SelectField label="周期" value={header.periodType} onChange={value => setHeader(c => ({ ...c, periodType: value }))} options={[{ value: "MONTH", label: "月度" }, { value: "QUARTER", label: "季度" }]} />
        <Field label="开始日" type="date" value={header.periodStart} onChange={value => setHeader(c => ({ ...c, periodStart: value }))} />
        <Field label="结束日" type="date" value={header.periodEnd} onChange={value => setHeader(c => ({ ...c, periodEnd: value }))} />
        <Field label="预测窗口（天）" value={header.forecastWindowDays} onChange={value => setHeader(c => ({ ...c, forecastWindowDays: value }))} />
        <Field label="季节系数（bp）" value={header.seasonalityBp} onChange={value => setHeader(c => ({ ...c, seasonalityBp: value }))} hint="10000 = 1.0 倍" />
      </div>
      <p className="text-xs text-muted">计划跨度 {days} 天。</p>

      <datalist id="ext-sku-options">{(options.data?.products ?? []).map(product => <option key={product.id} value={product.sku}>{product.asin}</option>)}</datalist>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="text-muted"><tr>{["SKU", "ASIN", "目标销量", "目标销售额", "单位成本", ""].map(head => <th key={head} className="pb-1 font-medium">{head}</th>)}</tr></thead>
          <tbody>{lines.map((line, index) => <tr key={index} className="border-t border-border">
            <td className="py-1.5 pr-2"><input list="ext-sku-options" className="h-8 w-full rounded border border-border bg-background px-2" value={line.sellerSku} onChange={event => setLines(current => current.map((item, i) => i === index ? { ...item, sellerSku: event.target.value } : item))} /></td>
            <td className="py-1.5 pr-2"><input className="h-8 w-full rounded border border-border bg-background px-2" value={line.asin} onChange={event => setLines(current => current.map((item, i) => i === index ? { ...item, asin: event.target.value } : item))} /></td>
            <td className="py-1.5 pr-2"><input className="h-8 w-full rounded border border-border bg-background px-2 tabular-nums" value={line.targetQty} onChange={event => setLines(current => current.map((item, i) => i === index ? { ...item, targetQty: event.target.value } : item))} /></td>
            <td className="py-1.5 pr-2"><input className="h-8 w-full rounded border border-border bg-background px-2 tabular-nums" value={line.targetRevenue} onChange={event => setLines(current => current.map((item, i) => i === index ? { ...item, targetRevenue: event.target.value } : item))} /></td>
            <td className="py-1.5 pr-2"><input className="h-8 w-full rounded border border-border bg-background px-2 tabular-nums" value={line.unitCost} onChange={event => setLines(current => current.map((item, i) => i === index ? { ...item, unitCost: event.target.value } : item))} /></td>
            <td className="py-1.5"><Button size="sm" variant="ghost" type="button" onClick={() => setLines(current => current.length > 1 ? current.filter((_, i) => i !== index) : current)}>删除</Button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={() => setLines(current => [...current, { ...emptyLine }])}>新增一行</Button>
        <Button size="sm" disabled={busy} onClick={save}>{editing ? "保存修改" : "创建计划"}</Button>
        {editing && <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setLines([{ ...emptyLine }]); setSelected(""); }}>退出编辑</Button>}
      </div>
    </Section>

    <Section title="计划清单" description="点击「载入明细」把行明细带入编辑区；关闭后不可再改。">
      <Table
        rows={plans.data?.items ?? []}
        empty="还没有销售计划。先建一份月度计划，填入重点 SKU 的目标销量与目标销售额。"
        columns={[
          { key: "name", label: "计划" },
          { key: "period", label: "周期", render: row => `${row.periodStart} ~ ${row.periodEnd}` },
          { key: "marketplace", label: "站点" },
          { key: "lineCount", label: "SKU 数", align: "right" },
          { key: "targetQty", label: "目标销量", align: "right" },
          { key: "forecastQty", label: "预测销量", align: "right" },
          { key: "targetRevenue", label: "目标销售额", align: "right", render: row => money(row.targetRevenue) },
          { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "ACTIVE" ? "good" : row.status === "CLOSED" ? "muted" : "info"} /> },
          { key: "ops", label: "操作", render: row => <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onClick={() => loadPlan(row)}>载入明细</Button>
            {row.status !== "CLOSED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("close-sales-plan", { id: row.id, revision: row.revision }, "计划已关闭。", plans.reload)}>关闭</Button>}
          </div> },
        ]}
      />
    </Section>

    {selected && <Section title={`执行偏差 · ${detail.data?.plan.name ?? ""}`} description="实际销量来自已同步订单；偏差为实际减目标，完成率低于 80% 视为落后。">
      {detail.data ? <>
        <Kpis items={[
          { label: "目标销量", value: String(detail.data.totals.targetQty) },
          { label: "实际销量", value: String(detail.data.totals.actualQty) },
          { label: "预测销量", value: String(detail.data.totals.forecastQty) },
          { label: "完成率", value: detail.data.totals.targetQty > 0 ? `${((detail.data.totals.actualQty / detail.data.totals.targetQty) * 100).toFixed(1)}%` : "—" },
        ]} />
        <Table
          rows={detail.data.lines}
          empty="该计划还没有行明细。"
          columns={[
            { key: "sellerSku", label: "SKU", render: row => <span className="font-mono">{row.sellerSku}</span> },
            { key: "asin", label: "ASIN" },
            { key: "targetQty", label: "目标", align: "right" },
            { key: "forecastQty", label: "预测", align: "right" },
            { key: "actualQty", label: "实际", align: "right" },
            { key: "gap", label: "偏差", align: "right", render: row => <span className={row.gap < 0 ? "text-red-700" : "text-emerald-700"}>{row.gap}</span> },
            { key: "completionBp", label: "完成率", align: "right", render: row => `${(row.completionBp / 100).toFixed(1)}%` },
          ]}
        />
      </> : <p className="text-xs text-muted">正在读取计划明细…</p>}
    </Section>}
  </div>;
}
