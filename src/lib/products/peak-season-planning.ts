/**
 * 旺季月份分析与智能备货规划 · 纯计算层
 *
 * 设计约束（来自需求文档）：
 * - 所有公式抽离为纯函数，便于测试与维护；这里不依赖 React、不读数据库、不取当前时间。
 * - 参数全部由调用方注入（配置化），禁止大量硬编码。
 * - 数据不足时返回 NEEDS_DATA 标记，绝不补零、不伪造分析结果。
 * - 权重当作销量等级识别（文档 3.1）；需求系数用于备货计算，二者分离。
 * - 日期按目标站点当地时区计算，时区由调用方传入 IANA 名（如 America/Los_Angeles）。
 *
 * 这里的"件数"是整数计数，用 number；金额/大整数不在此层处理。
 */

export const PEAK_SEASON_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export type DataStatus = "READY" | "NEEDS_DATA";

export type PeakInsightsConfig = {
  /** 旺季识别权重阈值：月权重 >= 该值视为旺季月，默认 60。可配置，非行业标准。 */
  peakThreshold: number;
  /** 旺季需求系数：下标 0..11 对应 1..12 月。可修改的初始建议值，非固定行业标准。 */
  demandCoefficients: number[];
  /** 物流各环节天数（日历天），由调用方注入；缺失项不得补零。 */
  leadTime: {
    productionDays: number | null;
    domesticDays: number | null;
    oceanDays: number | null;
    safetyDays: number | null;
  };
};

/** 默认建议配置——明确标注为可修改的初始值，不是行业标准，也不是已核验的物流数据。 */
export const DEFAULT_PEAK_INSIGHTS_CONFIG: PeakInsightsConfig = {
  peakThreshold: 60,
  demandCoefficients: [0.8, 0.8, 0.9, 1.1, 1.4, 1.4, 1.0, 1.2, 1.4, 1.2, 0.9, 0.8],
  leadTime: { productionDays: null, domesticDays: null, oceanDays: null, safetyDays: null },
};

export type SeasonWindow = {
  startMonth: number;
  endMonth: number;
  /** 人类可读，如 "4月–6月"。 */
  label: string;
};

export type Need = { field: string; message: string };

export type PeakInsightsInput = {
  /** 12 个月权重（1..12），已归一化到 10..100。 */
  weights: number[];
  /** 月目标销量原文（来自商品基础信息 targetSales），需可解析为正数。 */
  monthlyTargetSales: string | number | null | undefined;
  /** 有效在途库存（件）；数据接口未接入时传 null。 */
  inboundUnits: number | null;
  /** 当前可售库存（件）；数据接口未接入时传 null，仅展示不伪造。 */
  availableUnits: number | null;
  /** 货件是否已完成发货，用于"已完成"状态判定。 */
  shipmentCompleted: boolean;
  /** 目标站点 IANA 时区；未知站点传 null，日期计算标记 NEEDS_DATA。 */
  timeZone: string | null;
  /** 计算基准日（站点当地 YYYY-MM-DD）。由调用方按站点时区取"今天"后传入。 */
  today: string;
  /** 备货规划的年份（旺季所在年份）。 */
  year: number;
  config: PeakInsightsConfig;
};

export type PeakInsightsResult = {
  status: DataStatus;
  needs: Need[];
  /** 峰值月份（权重最高，可并列）。 */
  peakMonths: number[];
  /** 连续旺季窗口，可多个；低权重月不并入。 */
  seasonWindows: SeasonWindow[];
  /** 全年最高权重值。 */
  maxWeight: number;
  /** 旺季月目标销量（数值化后）。 */
  monthlyTarget: number | null;
  /** 旺季覆盖月份（各窗口内月份，去重升序）。 */
  coveredMonths: number[];
  /** 旺季总需求 = Σ(月目标 × 各覆盖月系数)。 */
  seasonalDemand: number | null;
  /** 建议发货量 = 旺季总需求 + 有效在途。在途缺失时为 null。 */
  suggestedShipment: number | null;
  /** 各覆盖月需求明细。 */
  monthlyDemand: Array<{ month: number; coefficient: number; demand: number }>;
  /** 回显调用方注入的库存值（仅展示，未接入时为 null）。 */
  availableUnits: number | null;
  inboundUnits: number | null;
  /** 最早旺季窗口的起始月。 */
  firstSeasonStartMonth: number | null;
  /** 旺季开始日期（站点当地 YYYY-MM-DD）。 */
  seasonStartDate: string | null;
  /** 物流总天数（日历天）。 */
  leadDays: number | null;
  /** 最晚海运发货日 = 旺季开始 - 物流总天数。 */
  latestShippingDate: string | null;
  /** 预计入仓上架日 = 旺季开始日（上限口径，等于开始日当天可用）。 */
  expectedReadyDate: string | null;
  /** 发货状态。 */
  shippingState: "UNKNOWN" | "NORMAL" | "WARNING" | "URGENT" | "COMPLETED";
  /** 距最晚发货日的天数（正=尚未到，负=已逾期）。 */
  daysToDeadline: number | null;
};

function normalizeWeights(weights: number[]): number[] | null {
  if (!Array.isArray(weights) || weights.length !== 12) return null;
  const normalized = weights.map((w) => Math.round(Number(w)));
  if (normalized.some((w) => !Number.isFinite(w))) return null;
  return normalized;
}

/** 峰值月份：权重最高者，允许并列。 */
export function identifyPeakMonths(weights: number[]): number[] {
  const w = normalizeWeights(weights);
  if (!w) return [];
  const max = Math.max(...w);
  return w.reduce<number[]>((acc, value, index) => (value === max ? [...acc, index + 1] : acc), []);
}

/**
 * 连续旺季窗口：月权重 >= 阈值为旺季月，连续月份合并为一个窗口；
 * 中间低权重月不并入，支持一年多个窗口。
 */
export function identifySeasonWindows(weights: number[], threshold: number): SeasonWindow[] {
  const w = normalizeWeights(weights);
  if (!w) return [];
  const isPeak = w.map((value) => value >= threshold);
  const windows: SeasonWindow[] = [];
  let start = -1;
  for (let i = 0; i < 12; i += 1) {
    if (isPeak[i] && start < 0) start = i;
    const isLast = i === 11;
    if (start >= 0 && (!isPeak[i] || isLast)) {
      const end = isPeak[i] && isLast ? i : i - 1;
      windows.push({ startMonth: start + 1, endMonth: end + 1, label: `${start + 1}月–${end + 1}月` });
      start = -1;
    }
  }
  return windows;
}

/** 数值化月目标销量；无法解析或 <=0 返回 null，不补零。 */
export function parseMonthlyTarget(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,，\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/** 某月需求系数（配置化，缺失/非法回退到 1，不算伪造分析结果，仅作为中性系数）。 */
export function coefficientForMonth(config: PeakInsightsConfig, month: number): number {
  const value = config.demandCoefficients[month - 1];
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

/** 物流总天数：任一环节缺失即返回 null（不补零）。 */
export function totalLeadDays(config: PeakInsightsConfig): number | null {
  const { productionDays, domesticDays, oceanDays, safetyDays } = config.leadTime;
  const parts = [productionDays, domesticDays, oceanDays, safetyDays];
  if (parts.some((p) => p === null || !Number.isFinite(p) || (p as number) < 0)) return null;
  return parts.reduce<number>((sum, p) => sum + (p as number), 0);
}

/** 校验日期字符串 YYYY-MM-DD。 */
function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** 在 UTC 轴上做日历天加减，仅处理纯日期（不含时刻），与时区无关。 */
function addDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** 站点当地"某年某月1日"；month 1..12。 */
function firstOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * 主计算入口：汇总全部洞察指标。
 * 纯函数：不读当前时间、不读数据库；today/timeZone/库存由调用方注入。
 */
export function buildPeakInsights(input: PeakInsightsInput): PeakInsightsResult {
  const needs: Need[] = [];
  const weights = normalizeWeights(input.weights);
  if (!weights) needs.push({ field: "peakSeasonWeights", message: "缺少 12 个月权重设置" });

  const peakMonths = weights ? identifyPeakMonths(weights) : [];
  const maxWeight = weights ? Math.max(...weights) : 0;
  const windows = weights ? identifySeasonWindows(weights, input.config.peakThreshold) : [];
  const coveredMonths = Array.from(new Set(windows.flatMap((w) => {
    const months: number[] = [];
    for (let m = w.startMonth; m <= w.endMonth; m += 1) months.push(m);
    return months;
  }))).sort((a, b) => a - b);

  if (windows.length === 0 && weights) {
    needs.push({ field: "seasonWindow", message: `没有月份达到旺季阈值 ${input.config.peakThreshold}` });
  }

  const monthlyTarget = parseMonthlyTarget(input.monthlyTargetSales);
  if (monthlyTarget === null && coveredMonths.length > 0) {
    needs.push({ field: "monthlyTargetSales", message: "缺少有效的月目标销量" });
  }

  const monthlyDemand = coveredMonths.map((month) => {
    const coefficient = coefficientForMonth(input.config, month);
    const demand = monthlyTarget === null ? 0 : Math.round(monthlyTarget * coefficient);
    return { month, coefficient, demand };
  });
  const seasonalDemand = monthlyTarget === null || coveredMonths.length === 0
    ? null
    : monthlyDemand.reduce((sum, row) => sum + row.demand, 0);

  const suggestedShipment = seasonalDemand === null || input.inboundUnits === null
    ? null
    : seasonalDemand + input.inboundUnits;
  if (seasonalDemand !== null && input.inboundUnits === null) {
    needs.push({ field: "inboundUnits", message: "有效在途库存接口未接入，建议发货量待接入" });
  }

  const firstSeasonStartMonth = windows.length ? windows[0].startMonth : null;
  const leadDays = totalLeadDays(input.config);
  if (firstSeasonStartMonth !== null && leadDays === null) {
    needs.push({ field: "leadTime", message: "物流周期配置不完整（生产/国内/海运/安全天数）" });
  }

  let seasonStartDate: string | null = null;
  let latestShippingDate: string | null = null;
  let expectedReadyDate: string | null = null;
  let shippingState: PeakInsightsResult["shippingState"] = "UNKNOWN";
  let daysToDeadline: number | null = null;

  const timeZoneOk = Boolean(input.timeZone) && isDateString(input.today);
  if (firstSeasonStartMonth !== null && !timeZoneOk) {
    needs.push({ field: "timeZone", message: "站点时区未核验或基准日无效，无法反推发货日期" });
  }

  if (firstSeasonStartMonth !== null && leadDays !== null && timeZoneOk) {
    seasonStartDate = firstOfMonth(input.year, firstSeasonStartMonth);
    latestShippingDate = addDays(seasonStartDate, -leadDays);
    expectedReadyDate = seasonStartDate;
    daysToDeadline = daysBetween(input.today, latestShippingDate);

    if (input.shipmentCompleted) {
      shippingState = "COMPLETED";
    } else if (daysToDeadline < 0) {
      shippingState = "URGENT";
    } else if (daysToDeadline < 30) {
      shippingState = "WARNING";
    } else {
      shippingState = "NORMAL";
    }
  }

  const status: DataStatus = needs.length === 0 ? "READY" : "NEEDS_DATA";
  return {
    status,
    needs,
    peakMonths,
    seasonWindows: windows,
    maxWeight,
    monthlyTarget,
    coveredMonths,
    seasonalDemand,
    suggestedShipment,
    monthlyDemand,
    availableUnits: input.availableUnits,
    inboundUnits: input.inboundUnits,
    firstSeasonStartMonth,
    seasonStartDate,
    leadDays,
    latestShippingDate,
    expectedReadyDate,
    shippingState,
    daysToDeadline,
  };
}

/** 旺季预警：距旺季开始 <=30 天、海运发货逾期。基于站点当地日期计算。 */
export function evaluatePeakWarnings(input: {
  seasonStartDate: string | null;
  latestShippingDate: string | null;
  today: string;
  shipmentCompleted: boolean;
}): Array<{ kind: "SEASON_STARTING" | "SHIPPING_OVERDUE"; message: string; tone: "warning" | "danger" }> {
  const warnings: Array<{ kind: "SEASON_STARTING" | "SHIPPING_OVERDUE"; message: string; tone: "warning" | "danger" }> = [];
  if (!isDateString(input.today)) return warnings;
  if (input.seasonStartDate) {
    const days = daysBetween(input.today, input.seasonStartDate);
    if (days >= 0 && days <= 30) {
      warnings.push({ kind: "SEASON_STARTING", message: `距旺季开始 ${days} 天`, tone: "warning" });
    }
  }
  if (input.latestShippingDate && !input.shipmentCompleted) {
    const overdue = daysBetween(input.latestShippingDate, input.today);
    if (overdue > 0) {
      warnings.push({ kind: "SHIPPING_OVERDUE", message: `海运发货已逾期 ${overdue} 天`, tone: "danger" });
    }
  }
  return warnings;
}

export const SHIPPING_STATE_LABEL: Record<PeakInsightsResult["shippingState"], string> = {
  UNKNOWN: "待接入",
  NORMAL: "正常",
  WARNING: "预警",
  URGENT: "紧急",
  COMPLETED: "已完成",
};

// ============================================================================
// 历史销售数据分析（需求文档第八章）
// 口径与 forecast/seasonality.buildMonthlyIndex 一致：月度季节指数 = 该月日均 / 全期日均。
// 这里独立实现，避免把 forecast 的类型依赖带进商品详情纯计算层。
// 严禁：缺失月份当零、不足完整销售周期套用成熟规律、自动覆盖人工权重。
// ============================================================================

export type HistoricalSale = { date: string; units: number };

export type MonthSeasonality = {
  month: number;
  /** 季节指数 = 该月日均 / 全期日均。不可靠时固定为 1。 */
  index: number;
  /** 该月有效样本天数。 */
  samples: number;
  /** 是否达到可靠性门槛。 */
  reliable: boolean;
};

export type SeasonalSuggestion = {
  status: DataStatus;
  needs: Need[];
  /** 数据来源说明（由调用方注入，如实标注，如 "sellfox_sales_daily / MSKU xxx"）。 */
  sourceNote: string;
  /** 分析覆盖的年份（从数据推断）。 */
  years: number[];
  /** 观测天数。 */
  observationDays: number;
  /** 是否覆盖完整 12 个月且样本充足。 */
  reliable: boolean;
  months: MonthSeasonality[];
  /** 由季节指数映射出的 12 月权重建议（10..100，步长10）。不可靠时为 null，不生成建议。 */
  suggestedWeights: number[] | null;
  /** 峰值月份（指数最高，可并列；仅可靠时给出）。 */
  peakMonths: number[];
};

export type SeasonalSuggestionConfig = {
  /** 每月最少样本天数，默认 2（与 buildMonthlyIndex 一致）。 */
  minPerMonth?: number;
  /** 最少覆盖月份数，默认 12。 */
  minMonths?: number;
  /** 最少观测天数，默认 60。 */
  minObservations?: number;
};

/**
 * 从历史日销量生成月度季节指数与权重建议。
 * - 只接受合法日期与整数件数；重复日期、非法值直接剔除，不补零。
 * - 缺失的月份 samples=0、index=1、reliable=false，绝不按零销量处理。
 * - 未达可靠性门槛时 suggestedWeights=null、peakMonths=[]，不生成旺季结论。
 * - 纯函数：不读当前时间、不写库，sourceNote 由调用方如实传入。
 */
export function suggestWeightsFromHistory(
  observations: HistoricalSale[],
  sourceNote: string,
  config: SeasonalSuggestionConfig = {},
): SeasonalSuggestion {
  const minPerMonth = config.minPerMonth ?? 2;
  const minMonths = config.minMonths ?? 12;
  const minObservations = config.minObservations ?? 60;
  const needs: Need[] = [];

  // 去重 + 校验：同一天多条或非法值剔除（与 extractHistoricalSales 的"歧义日丢弃"口径一致）。
  const byDate = new Map<string, number | null>();
  const yearsSet = new Set<number>();
  for (const row of observations) {
    if (!isDateString(row.date)) continue;
    const units = row.units;
    if (!Number.isInteger(units) || units < 0) continue;
    yearsSet.add(Number(row.date.slice(0, 4)));
    if (byDate.has(row.date)) { byDate.set(row.date, null); continue; }
    byDate.set(row.date, units);
  }
  const clean = [...byDate].filter((entry): entry is [string, number] => entry[1] !== null);
  const observationDays = clean.length;

  if (observationDays < minObservations) {
    needs.push({ field: "history", message: `历史样本 ${observationDays} 天，少于 ${minObservations} 天，不做季节推断` });
  }

  const total = clean.reduce((sum, [, units]) => sum + units, 0);
  if (total <= 0) {
    needs.push({ field: "history", message: "历史销量合计为 0，无法计算季节指数" });
  }

  const buckets = new Map<number, number[]>();
  for (const [date, units] of clean) {
    const month = Number(date.slice(5, 7));
    const list = buckets.get(month) ?? [];
    list.push(units);
    buckets.set(month, list);
  }
  const coveredMonths = buckets.size;
  if (coveredMonths < minMonths) {
    needs.push({ field: "history", message: `仅覆盖 ${coveredMonths} 个月，少于 ${minMonths} 个月，不做季节推断` });
  }

  const overall = observationDays > 0 ? total / observationDays : 0;
  const months: MonthSeasonality[] = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const values = buckets.get(month) ?? [];
    const samples = values.length;
    const reliable = coveredMonths >= minMonths && samples >= minPerMonth;
    const mean = samples > 0 ? values.reduce((s, v) => s + v, 0) / samples : 0;
    const index = reliable && overall > 0 ? round4(mean / overall) : 1;
    return { month, index, samples, reliable };
  });

  const reliable = needs.length === 0 && months.every((m) => m.reliable);
  let suggestedWeights: number[] | null = null;
  let peakMonths: number[] = [];
  if (reliable) {
    // 指数→权重：以最高指数为 100 线性缩放，再归一到 10..100、步长10。
    const maxIndex = Math.max(...months.map((m) => m.index));
    if (maxIndex > 0) {
      suggestedWeights = months.map((m) => {
        const scaled = (m.index / maxIndex) * 100;
        const stepped = Math.round(scaled / 10) * 10;
        return Math.max(10, Math.min(100, stepped));
      });
      const maxWeight = Math.max(...suggestedWeights);
      peakMonths = suggestedWeights.reduce<number[]>((acc, w, i) => (w === maxWeight ? [...acc, i + 1] : acc), []);
    }
  }

  const status: DataStatus = reliable ? "READY" : "NEEDS_DATA";
  return {
    status,
    needs,
    sourceNote,
    years: [...yearsSet].sort((a, b) => a - b),
    observationDays,
    reliable,
    months,
    suggestedWeights,
    peakMonths,
  };
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
