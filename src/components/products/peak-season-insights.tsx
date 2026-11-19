"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import {
  DEFAULT_PEAK_INSIGHTS_CONFIG,
  SHIPPING_STATE_LABEL,
  buildPeakInsights,
  evaluatePeakWarnings,
  suggestWeightsFromHistory,
  type HistoricalSale,
  type PeakInsightsConfig,
  type PeakInsightsResult,
} from "@/lib/products/peak-season-planning";

type Props = {
  /** 12 个月权重（来自商品详情 improvement.peakSeasonWeights）。 */
  weights: number[];
  /** 月目标销量（来自 improvement.targetSales）。 */
  monthlyTargetSales: string;
  /** 计算基准日（站点当地 YYYY-MM-DD）。默认取浏览器当地日期，可由运营覆盖。 */
  today?: string;
  /** 应用历史分析权重建议的回调。仅在运营显式确认后调用，绝不自动覆盖人工权重。 */
  onApplyWeights?: (weights: number[]) => void;
};

function todayLocal(): string {
  if (typeof window === "undefined") return "";
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 解析"日期,件数"逐行文本；非法行忽略，真正的脏数据交给纯函数处理。 */
function parseHistoryText(text: string): HistoricalSale[] {
  const rows: HistoricalSale[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [date, unitsRaw] = trimmed.split(/[,，\t]+/).map((p) => p?.trim() ?? "");
    if (!date || unitsRaw === undefined || unitsRaw === "") continue;
    const units = Number(unitsRaw);
    if (!Number.isFinite(units)) continue;
    rows.push({ date, units });
  }
  return rows;
}

function parseCoefficients(text: string): number[] | null {
  const tokens = text.split(/[,，\s]+/).map((p) => p.trim()).filter((p) => p !== "");
  if (tokens.length !== 12) return null;
  const parts = tokens.map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts;
}

const stateTone: Record<PeakInsightsResult["shippingState"], "success" | "warning" | "danger" | "info" | "neutral"> = {
  NORMAL: "success",
  WARNING: "warning",
  URGENT: "danger",
  COMPLETED: "info",
  UNKNOWN: "neutral",
};

/** 指标行：标签 + 突出数值 + 弱说明。 */
function Metric({
  label,
  value,
  hint,
  emphasize,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasize?: boolean;
  tone?: "warning" | "danger";
}) {
  const valueClass = tone === "danger"
    ? "text-danger-ink"
    : tone === "warning"
      ? "text-warning-ink"
      : emphasize
        ? "text-accent"
        : "text-foreground";
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

/** 数字输入（紧凑），允许留空表示待接入。 */
function NumInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      inputMode="decimal"
      className={`h-7 w-full rounded border border-border bg-surface px-1.5 text-label text-foreground outline-none focus:border-brand ${className ?? ""}`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * 系统洞察面板（右侧）。所有计算走纯函数 peak-season-planning；
 * 库存/物流/时区属于"待接入"数据，缺省为空并显示数据不足提示，绝不伪造。
 */
export function PeakSeasonInsights({ weights, monthlyTargetSales, today, onApplyWeights }: Props) {
  const [threshold, setThreshold] = useState(String(DEFAULT_PEAK_INSIGHTS_CONFIG.peakThreshold));
  const [coefText, setCoefText] = useState(DEFAULT_PEAK_INSIGHTS_CONFIG.demandCoefficients.join(","));
  const [productionDays, setProductionDays] = useState("");
  const [domesticDays, setDomesticDays] = useState("");
  const [oceanDays, setOceanDays] = useState("");
  const [safetyDays, setSafetyDays] = useState("");
  const [inbound, setInbound] = useState("");
  const [available, setAvailable] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [baseToday, setBaseToday] = useState(today ?? todayLocal());
  const [shipmentCompleted, setShipmentCompleted] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyText, setHistoryText] = useState("");
  const [historySource, setHistorySource] = useState("");

  const baseYear = useMemo(() => {
    const y = Number(baseToday.slice(0, 4));
    return Number.isFinite(y) && y >= 2000 ? y : new Date().getFullYear();
  }, [baseToday]);

  const config = useMemo<PeakInsightsConfig>(() => ({
    peakThreshold: Number(threshold) || DEFAULT_PEAK_INSIGHTS_CONFIG.peakThreshold,
    demandCoefficients: parseCoefficients(coefText) ?? DEFAULT_PEAK_INSIGHTS_CONFIG.demandCoefficients,
    leadTime: {
      productionDays: productionDays === "" ? null : Number(productionDays),
      domesticDays: domesticDays === "" ? null : Number(domesticDays),
      oceanDays: oceanDays === "" ? null : Number(oceanDays),
      safetyDays: safetyDays === "" ? null : Number(safetyDays),
    },
  }), [threshold, coefText, productionDays, domesticDays, oceanDays, safetyDays]);

  const result = useMemo(() => buildPeakInsights({
    weights,
    monthlyTargetSales,
    inboundUnits: inbound === "" ? null : Number(inbound),
    availableUnits: available === "" ? null : Number(available),
    shipmentCompleted,
    timeZone: timeZone.trim() || null,
    today: baseToday,
    year: baseYear,
    config,
  }), [weights, monthlyTargetSales, inbound, available, shipmentCompleted, timeZone, baseToday, baseYear, config]);

  const warnings = useMemo(() => evaluatePeakWarnings({
    seasonStartDate: result.seasonStartDate,
    latestShippingDate: result.latestShippingDate,
    today: baseToday,
    shipmentCompleted,
  }), [result.seasonStartDate, result.latestShippingDate, baseToday, shipmentCompleted]);

  const seasonal = useMemo(() => {
    if (!showHistory || historyText.trim() === "") return null;
    const source = historySource.trim() || "运营手工导入（数据接口待接入）";
    return suggestWeightsFromHistory(parseHistoryText(historyText), source);
  }, [showHistory, historyText, historySource]);

  function applySeasonalWeights() {
    if (!seasonal?.suggestedWeights || !onApplyWeights) return;
    const ok = window.confirm("将用历史分析的季节权重建议覆盖当前 12 个月人工设置。此操作会替换现有权重，确认应用？");
    if (ok) onApplyWeights(seasonal.suggestedWeights);
  }

  const peakText = result.peakMonths.length ? result.peakMonths.map((m) => `${m}月`).join("、") : "—";
  const windowText = result.seasonWindows.length ? result.seasonWindows.map((w) => w.label).join(" · ") : "—";
  const demandText = result.seasonalDemand === null ? "待接入" : `${result.seasonalDemand} pcs`;
  const shipmentText = result.suggestedShipment === null ? "待接入" : `${result.suggestedShipment} pcs`;

  return (
    <Card className="min-w-[320px] flex-1 bg-warning-soft/40">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-foreground">系统洞察</div>
          <div className="flex items-center gap-1.5">
            {result.status === "NEEDS_DATA"
              ? <Badge tone="warning">数据不足</Badge>
              : <Badge tone="success">已就绪</Badge>}
            <button
              type="button"
              className="rounded border border-border bg-surface px-2 py-0.5 text-label font-semibold text-muted hover:border-brand hover:text-brand"
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? "收起历史" : "历史分析"}
            </button>
            <button
              type="button"
              className="rounded border border-border bg-surface px-2 py-0.5 text-label font-semibold text-muted hover:border-brand hover:text-brand"
              onClick={() => setShowConfig((v) => !v)}
            >
              {showConfig ? "收起参数" : "参数配置"}
            </button>
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-surface/70 px-2">
          <Metric label="峰值月份" value={peakText} emphasize />
          <Metric label="旺季窗口" value={windowText} />
          <Metric label="需求系数" value={result.coveredMonths.length ? result.coveredMonths.map((m) => `${m}月×${result.monthlyDemand.find((d) => d.month === m)?.coefficient ?? 1}`).join(" ") : "—"} />
          <Metric label="旺季月目标" value={result.monthlyTarget === null ? "待接入" : `${result.monthlyTarget} pcs`} />
          <Metric label="旺季预计需求" value={demandText} />
          <Metric label="可用 / 在途" value={`${result.availableUnits ?? "—"} / ${result.inboundUnits ?? "—"}`} />
          <Metric label="建议发货量" value={shipmentText} emphasize />
          <Metric label="旺季开始" value={result.seasonStartDate ?? "待接入"} />
          <Metric label="最晚海运发货" value={result.latestShippingDate ?? "待接入"} emphasize tone={result.shippingState === "URGENT" ? "danger" : result.shippingState === "WARNING" ? "warning" : undefined} />
          <Metric label="预计入仓上架" value={result.expectedReadyDate ?? "待接入"} />
          <div className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="shrink-0 text-label text-muted">发货状态</span>
            <Badge tone={stateTone[result.shippingState]}>{SHIPPING_STATE_LABEL[result.shippingState]}</Badge>
          </div>
        </div>

        {warnings.map((w) => (
          <Alert key={w.kind} tone={w.tone}>{w.message}</Alert>
        ))}

        {result.status === "NEEDS_DATA" ? (
          <Alert tone="warning" title="部分指标待接入" description={result.needs.slice(0, 3).map((n) => n.message).join("；")} />
        ) : null}

        {showConfig ? (
          <div className="space-y-2 rounded-md border border-border bg-surface/70 p-2">
            <p className="text-label text-muted">系数为可修改的初始建议值；库存 / 物流 / 时区无接口时留空即标记待接入，不生成假数据。</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-label text-muted">旺季阈值
                <NumInput value={threshold} onChange={setThreshold} placeholder="60" />
              </label>
              <label className="space-y-1 text-label text-muted">基准日(站点当地)
                <input className="h-7 w-full rounded border border-border bg-surface px-1.5 text-label text-foreground outline-none focus:border-brand" value={baseToday} placeholder="YYYY-MM-DD" onChange={(e) => setBaseToday(e.target.value)} />
              </label>
              <label className="space-y-1 text-label text-muted">生产天数
                <NumInput value={productionDays} onChange={setProductionDays} placeholder="待接入" />
              </label>
              <label className="space-y-1 text-label text-muted">国内运输天数
                <NumInput value={domesticDays} onChange={setDomesticDays} placeholder="待接入" />
              </label>
              <label className="space-y-1 text-label text-muted">海运天数
                <NumInput value={oceanDays} onChange={setOceanDays} placeholder="待接入" />
              </label>
              <label className="space-y-1 text-label text-muted">安全天数
                <NumInput value={safetyDays} onChange={setSafetyDays} placeholder="待接入" />
              </label>
              <label className="space-y-1 text-label text-muted">有效在途(pcs)
                <NumInput value={inbound} onChange={setInbound} placeholder="待接入" />
              </label>
              <label className="space-y-1 text-label text-muted">可用库存(pcs)
                <NumInput value={available} onChange={setAvailable} placeholder="待接入" />
              </label>
            </div>
            <label className="block space-y-1 text-label text-muted">站点 IANA 时区（未知请留空）
              <input className="h-7 w-full rounded border border-border bg-surface px-1.5 text-label text-foreground outline-none focus:border-brand" value={timeZone} placeholder="如 America/Los_Angeles" onChange={(e) => setTimeZone(e.target.value)} />
            </label>
            <label className="block space-y-1 text-label text-muted">12 个月需求系数（逗号分隔）
              <input className="h-7 w-full rounded border border-border bg-surface px-1.5 text-label text-foreground outline-none focus:border-brand" value={coefText} onChange={(e) => setCoefText(e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-label text-muted">
              <input type="checkbox" checked={shipmentCompleted} onChange={(e) => setShipmentCompleted(e.target.checked)} />
              货件已完成发货
            </label>
          </div>
        ) : null}

        {showHistory ? (
          <div className="space-y-2 rounded-md border border-border bg-surface/70 p-2">
            <p className="text-label text-muted">
              粘贴真实日销量（每行 <code>YYYY-MM-DD,件数</code>）自动计算月度季节指数与权重建议。数据接口未接入时由运营导入，缺月份不当零、新品/短周期不生成建议；建议不会自动覆盖人工权重。
            </p>
            <label className="block space-y-1 text-label text-muted">数据来源标注（如实填写，展示用）
              <input className="h-7 w-full rounded border border-border bg-surface px-1.5 text-label text-foreground outline-none focus:border-brand" value={historySource} placeholder="如 sellfox_sales_daily / MSKU ABC" onChange={(e) => setHistorySource(e.target.value)} />
            </label>
            <textarea
              className="h-24 w-full resize-y rounded border border-border bg-surface px-1.5 py-1 font-mono text-label text-foreground outline-none focus:border-brand"
              value={historyText}
              placeholder={"2024-01-01,10\n2024-01-05,12\n..."}
              onChange={(e) => setHistoryText(e.target.value)}
            />

            {seasonal ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={seasonal.status === "READY" ? "success" : "warning"}>
                    {seasonal.status === "READY" ? "分析可靠" : "数据不足"}
                  </Badge>
                  <span className="text-label text-muted">
                    观测 {seasonal.observationDays} 天{seasonal.years.length ? ` · ${seasonal.years[0]}–${seasonal.years[seasonal.years.length - 1]}` : ""}
                  </span>
                </div>
                <DataTable
                  rows={seasonal.months}
                  getRowKey={(m) => String(m.month)}
                  density="compact"
                  maxHeight="8rem"
                  ariaLabel="月度季节指数与权重建议"
                  rowClassName={(m) => (m.reliable ? undefined : "text-muted")}
                  columns={[
                    { key: "month", header: "月", width: 40, align: "center", render: (m) => m.month },
                    { key: "index", header: "指数", width: 56, align: "center", render: (m) => (m.reliable ? m.index.toFixed(2) : "—") },
                    { key: "samples", header: "样本", width: 52, align: "center", render: (m) => m.samples },
                    { key: "weight", header: "建议权重", width: 72, align: "center", render: (m) => (seasonal.suggestedWeights ? seasonal.suggestedWeights[m.month - 1] : "—") },
                  ]}
                />
                <p className="text-label text-muted">数据来源：{seasonal.sourceNote}</p>
                {seasonal.status === "NEEDS_DATA" ? (
                  <Alert tone="warning" title="未生成权重建议" description={seasonal.needs.slice(0, 3).map((n) => n.message).join("；")} />
                ) : null}
                {seasonal.peakMonths.length ? (
                  <p className="text-label text-foreground">自动识别峰值月：{seasonal.peakMonths.map((m) => `${m}月`).join("、")}</p>
                ) : null}
                {seasonal.suggestedWeights && onApplyWeights ? (
                  <Button type="button" variant="secondary" onClick={applySeasonalWeights}>应用建议权重到 12 月网格</Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
