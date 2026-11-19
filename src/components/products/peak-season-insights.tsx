"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  DEFAULT_PEAK_INSIGHTS_CONFIG,
  buildPeakInsights,
} from "@/lib/products/peak-season-planning";

type Props = {
  /** 12 个月权重（来自商品详情 improvement.peakSeasonWeights）。 */
  weights: number[];
  /** 月目标销量（来自 improvement.targetSales）。 */
  monthlyTargetSales: string;
  /** 计算基准日（站点当地 YYYY-MM-DD）。默认取浏览器当地日期。 */
  today?: string;
};

function todayLocal(): string {
  if (typeof window === "undefined") return "";
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 指标行：标签 + 突出数值 + 弱说明。 */
function Metric({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasize?: boolean;
}) {
  const valueClass = emphasize ? "text-accent" : "text-foreground";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="shrink-0 text-label text-muted">{label}</span>
      <span className="text-right">
        <span className={`text-sm font-semibold ${valueClass}`}>{value}</span>
        {hint ? <span className="ml-1 text-label text-muted">{hint}</span> : null}
      </span>
    </div>
  );
}

/**
 * 系统洞察面板（右侧）：峰值月、旺季窗口、需求系数、月目标与预计需求，
 * 并附旺季预计需求计算公式。所有计算走纯函数 peak-season-planning，不伪造数据。
 */
export function PeakSeasonInsights({ weights, monthlyTargetSales, today }: Props) {
  const baseToday = today ?? todayLocal();

  const baseYear = useMemo(() => {
    const y = Number(baseToday.slice(0, 4));
    return Number.isFinite(y) && y >= 2000 ? y : new Date().getFullYear();
  }, [baseToday]);

  const result = useMemo(() => buildPeakInsights({
    weights,
    monthlyTargetSales,
    inboundUnits: null,
    availableUnits: null,
    shipmentCompleted: false,
    timeZone: null,
    today: baseToday,
    year: baseYear,
    config: DEFAULT_PEAK_INSIGHTS_CONFIG,
  }), [weights, monthlyTargetSales, baseToday, baseYear]);

  const peakText = result.peakMonths.length ? result.peakMonths.map((m) => `${m}月`).join("、") : "—";
  const windowText = result.seasonWindows.length ? result.seasonWindows.map((w) => w.label).join(" · ") : "—";
  const demandText = result.seasonalDemand === null ? "待接入" : `${result.seasonalDemand} pcs`;
  const coefficientText = result.coveredMonths.length
    ? result.coveredMonths.map((m) => `${m}月×${result.monthlyDemand.find((d) => d.month === m)?.coefficient ?? 1}`).join(" ")
    : "—";

  return (
    <Card className="flex h-full min-w-[320px] flex-1 flex-col bg-warning-soft/40">
      <CardContent className="flex h-full flex-1 flex-col space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-foreground">系统洞察</div>
          {result.status === "NEEDS_DATA"
            ? <Badge tone="warning">数据不足</Badge>
            : <Badge tone="success">已就绪</Badge>}
        </div>

        <div className="rounded-md border border-border/60 bg-surface/70 px-2">
          <Metric label="峰值月份" value={peakText} emphasize />
          <Metric label="旺季窗口" value={windowText} />
          <Metric label="需求系数" value={coefficientText} />
          <Metric label="旺季月目标" value={result.monthlyTarget === null ? "待接入" : `${result.monthlyTarget} pcs`} />
          <Metric label="旺季预计需求" value={demandText} />
        </div>

        <div className="rounded-md border border-border bg-surface/70 p-2">
          <div className="text-label font-semibold text-foreground">旺季预计需求计算公式</div>
          <p className="mt-1 text-label leading-5 text-muted">
            旺季预计需求 = Σ（旺季覆盖月目标销量 × 该月需求系数）
          </p>
          <p className="mt-1 text-label text-muted">
            当前覆盖月：{result.coveredMonths.length ? result.coveredMonths.map((m) => `${m}月`).join("、") : "—"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
