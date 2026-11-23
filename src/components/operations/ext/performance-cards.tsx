"use client";

import { useState } from "react";
import { Badge, bp } from "./kit";

/** 绩效卡片口径：与 performanceVerdict 共用同一套阈值，不新造判定规则。 */
export type PerfSnapshot = {
  id: string;
  marketplace: string;
  periodStart: string;
  periodEnd: string;
  totalOrders: number;
  orderDefectRateBp: number;
  lateShipmentRateBp: number;
  cancellationRateBp: number;
  validTrackingRateBp: number;
  negativeFeedbackRateBp: number;
  verdict: {
    ok: boolean;
    breached: string[];
    flags: Array<{ metric: string; valueBp: number; thresholdBp: number; ok: boolean; rule: string }>;
  };
};

type MetricKey = "negativeFeedbackRateBp" | "cancellationRateBp" | "orderDefectRateBp" | "lateShipmentRateBp" | "validTrackingRateBp";

/** 三张卡按亚马逊账户健康维度归类：客户服务 / 商品合规 / 配送。 */
const CARD_SPECS: Array<{ title: string; subtitle: string; keys: MetricKey[] }> = [
  { title: "客户服务", subtitle: "差评率 / 取消率", keys: ["negativeFeedbackRateBp", "cancellationRateBp"] },
  { title: "商品合规", subtitle: "订单缺陷率（含差评 / 索赔 / 拒付）", keys: ["orderDefectRateBp"] },
  { title: "配送", subtitle: "迟发率 / 有效追踪率", keys: ["lateShipmentRateBp", "validTrackingRateBp"] },
];

const LABELS: Record<MetricKey, string> = {
  orderDefectRateBp: "ODR 订单缺陷率",
  lateShipmentRateBp: "迟发率",
  cancellationRateBp: "取消率",
  validTrackingRateBp: "有效追踪率",
  negativeFeedbackRateBp: "差评率",
};
const HIGHER_BETTER = new Set<MetricKey>(["validTrackingRateBp"]);
const RULES: Record<MetricKey, string> = {
  orderDefectRateBp: "< 1%",
  lateShipmentRateBp: "≤ 4%",
  cancellationRateBp: "≤ 2.5%",
  validTrackingRateBp: "≥ 95%",
  negativeFeedbackRateBp: "≤ 1%",
};
const THRESHOLDS: Record<MetricKey, number> = {
  orderDefectRateBp: 100,
  lateShipmentRateBp: 400,
  cancellationRateBp: 250,
  validTrackingRateBp: 9500,
  negativeFeedbackRateBp: 100,
};

type Metric = { key: MetricKey; label: string; valueBp: number; thresholdBp: number; rule: string; ok: boolean; higherBetter: boolean };

function metricsOf(row: PerfSnapshot, keys: MetricKey[]): Metric[] {
  return keys.map((key) => {
    const valueBp = Number(row[key] ?? 0);
    const thresholdBp = THRESHOLDS[key];
    const higherBetter = HIGHER_BETTER.has(key);
    return { key, label: LABELS[key], valueBp, thresholdBp, rule: RULES[key], higherBetter, ok: higherBetter ? valueBp >= thresholdBp : valueBp <= thresholdBp };
  });
}

function MetricRow({ metric }: { metric: Metric }) {
  // 进度条：以阈值为满格参照，超额/不足的部分用达标色与超标色区分；阈值处画刻度线。
  const scale = metric.higherBetter ? 10_000 : Math.max(metric.thresholdBp * 2, metric.valueBp, 1);
  const pct = Math.min(100, Math.max(0, (metric.valueBp / scale) * 100));
  const marker = Math.min(100, Math.max(0, (metric.thresholdBp / scale) * 100));
  const color = metric.ok ? "var(--success)" : "var(--danger)";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">{metric.label}</span>
        <span className="tabular-nums">
          <strong className={metric.ok ? "text-success-ink" : "text-danger-ink"}>{bp(metric.valueBp)}</strong>
          <span className="text-muted"> / 目标 {metric.rule}</span>
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded bg-surface-muted" role="img" aria-label={`${metric.label} 当前 ${bp(metric.valueBp)}，目标 ${metric.rule}`}>
        <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${pct}%`, background: color }} />
        <div className="absolute inset-y-0 border-l border-foreground" style={{ left: `${marker}%` }} aria-hidden="true" />
      </div>
    </div>
  );
}

function DimensionCard({ title, subtitle, current, history }: { title: string; subtitle: string; current: PerfSnapshot; history: PerfSnapshot[] }) {
  const [showHistory, setShowHistory] = useState(false);
  const keys = CARD_SPECS.find((spec) => spec.title === title)!.keys;
  const metrics = metricsOf(current, keys);
  const ok = metrics.every((metric) => metric.ok);
  return (
    <div className="flex flex-col gap-3 rounded border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-label text-muted">{subtitle}</p>
        </div>
        <Badge text={ok ? "达标" : "超标"} tone={ok ? "good" : "warn"} />
      </div>
      <p className="text-label text-muted">统计区间 {current.periodStart} ~ {current.periodEnd} · {current.marketplace} · {current.totalOrders.toLocaleString()} 单</p>
      <div className="space-y-2">{metrics.map((metric) => <MetricRow key={metric.key} metric={metric} />)}</div>
      {history.length ? (
        <div className="border-t border-border pt-2 text-xs">
          <button type="button" className="text-brand underline decoration-dotted" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}>
            {showHistory ? "收起历史" : `历史（${history.length}）`}
          </button>
          {showHistory ? (
            <div className="mt-2 space-y-1">
              {history.map((item) => {
                const rowMetrics = metricsOf(item, keys);
                const rowOk = rowMetrics.every((metric) => metric.ok);
                return (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-label text-muted">
                    <span>{item.periodStart} ~ {item.periodEnd}</span>
                    <span className={rowOk ? "text-success-ink" : "text-danger-ink"}>{rowMetrics.map((m) => `${m.label} ${bp(m.valueBp)}`).join(" / ")}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 三卡绩效：客户服务 / 商品合规 / 配送，含区间、当前值、目标阈值、拆解、进度条与达标色；历史折叠卡底。 */
export function PerformanceCards({ items }: { items: PerfSnapshot[] }) {
  if (!items.length) return null;
  // 取最新一份作为"当前值"（服务端按 periodStart desc 返回），其余同站点快照进入历史。
  const current = items[0];
  const history = items.filter((item) => item.marketplace === current.marketplace && item.id !== current.id);
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {CARD_SPECS.map((spec) => (
        <DimensionCard key={spec.title} title={spec.title} subtitle={spec.subtitle} current={current} history={history} />
      ))}
    </div>
  );
}
