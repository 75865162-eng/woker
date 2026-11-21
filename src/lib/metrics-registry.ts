/**
 * 权威指标字典（任务书 P1-6：指标 code / 公式 / 口径唯一）。
 *
 * 背景：此前 ACOS/ROAS/CTR/CPC/CVR 等公式散落在 metrics.ts、ads-proposal.ts、
 * rule-engine 等多处，口径容易分叉。本模块把这些派生指标的公式集中为唯一真相源，
 * 供 enrichMetric / 聚合函数 / 规则引擎 / 报表共用，杜绝"同一指标多种算法"。
 *
 * 红线：
 * - 公式与此前的实现逐字等价（0 差异），本轮只做集中，不改任何数值口径；
 * - 缺少观测指标或分母为 0 时的返回语义保持原样（ACOS 返回 null，其余返回 0）；
 * - 金额缺失不补造零值：由调用方 requireObservedMetrics 负责，本模块只做纯计算。
 */
export type ObservedMetrics = {
  spend: number;
  sales: number;
  clicks: number;
  impressions: number;
  orders: number;
};

export type MetricCode =
  | "acos"
  | "roas"
  | "ctr"
  | "cpc"
  | "cvr"
  | "cpa"
  | "acots"
  | "asots";

export type MetricDefinition = {
  code: MetricCode;
  name: string;
  /** 人类可读公式，作为口径文档的唯一来源。 */
  formula: string;
  /** 展示单位：百分比 / 倍数 / 金额。 */
  unit: "%" | "x" | "currency";
  /** 展示精度（小数位）。 */
  precision: number;
  /** 零分母时的既有语义：null 表示"未知"（仅 ACOS），否则返回 0 或回退 spend。 */
  zeroDenominator: "null" | "zero" | "spend";
  compute: (o: ObservedMetrics) => number | null;
};

export const METRIC_REGISTRY: Readonly<Record<MetricCode, MetricDefinition>> = Object.freeze({
  acos: {
    code: "acos", name: "ACOS", formula: "spend / sales * 100",
    unit: "%", precision: 1, zeroDenominator: "null",
    compute: (o) => (o.sales > 0 ? (o.spend / o.sales) * 100 : null),
  },
  roas: {
    code: "roas", name: "ROAS", formula: "sales / spend",
    unit: "x", precision: 2, zeroDenominator: "zero",
    compute: (o) => (o.spend > 0 ? o.sales / o.spend : 0),
  },
  ctr: {
    code: "ctr", name: "CTR", formula: "clicks / impressions * 100",
    unit: "%", precision: 2, zeroDenominator: "zero",
    compute: (o) => (o.impressions > 0 ? (o.clicks / o.impressions) * 100 : 0),
  },
  cpc: {
    code: "cpc", name: "CPC", formula: "spend / clicks",
    unit: "currency", precision: 2, zeroDenominator: "zero",
    compute: (o) => (o.clicks > 0 ? o.spend / o.clicks : 0),
  },
  cvr: {
    code: "cvr", name: "CVR", formula: "orders / clicks * 100",
    unit: "%", precision: 2, zeroDenominator: "zero",
    compute: (o) => (o.clicks > 0 ? (o.orders / o.clicks) * 100 : 0),
  },
  cpa: {
    code: "cpa", name: "CPA", formula: "spend / orders，分母为 0 时回退 spend",
    unit: "currency", precision: 2, zeroDenominator: "spend",
    compute: (o) => (o.orders > 0 ? o.spend / o.orders : o.spend),
  },
  acots: {
    code: "acots", name: "ACOTS", formula: "spend / (sales * 1.18) * 100",
    unit: "%", precision: 1, zeroDenominator: "zero",
    compute: (o) => (o.sales > 0 ? (o.spend / (o.sales * 1.18)) * 100 : 0),
  },
  asots: {
    code: "asots", name: "ASOTS", formula: "sales / (sales * 1.32) * 100",
    unit: "%", precision: 1, zeroDenominator: "zero",
    // 与既有实现一致：分母 sales*1.32，sales>0 时恒为 1/1.32*100。
    compute: (o) => (o.sales > 0 ? (o.sales / (o.sales * 1.32)) * 100 : 0),
  },
});

/** 唯一计算入口：所有派生指标都从这里取公式。未知 code 返回 null。 */
export function computeMetric(code: string, observed: ObservedMetrics): number | null {
  const def = METRIC_REGISTRY[code as MetricCode];
  return def ? def.compute(observed) : null;
}

/** 供指标字典页 / 文档消费的稳定元数据列表（不含函数，便于序列化）。 */
export function listMetricDefinitions(): Array<Omit<MetricDefinition, "compute">> {
  return (Object.keys(METRIC_REGISTRY) as MetricCode[]).map((code) => {
    const { compute: _compute, ...meta } = METRIC_REGISTRY[code];
    return meta;
  });
}
