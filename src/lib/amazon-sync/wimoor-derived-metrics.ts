/**
 * Wimoor 派生指标——源码实证公式的纯函数实现。
 *
 * 取证来源（2026-11-24，Wimoor 快照 ec86736b）：
 * - 广告：AmzAdvReportTargetQueryMapper.xml:211-221（SP/SD/HSA 同族 Mapper 一致）
 *   avgcost = sum(cost)/sum(clicks)；CTR = sum(clicks)/sum(impressions)
 *   ACOS = (cost>0 且 sales=0) ? 10000000000 : sum(cost)/sum(attributedSales7d)
 *   ROAS = sum(attributedSales7d)/sum(cost)；CSRT = sum(attributedConversions7d)/sum(clicks)
 * - 利润：AmzSettlementReportServiceImpl.handlerSettlementSKURowData:1739-1762
 *   setincome = sum(principal+commission+fbafee+refund+otherfee+tax+shipping+promotion)
 *   profit = setincome - local_other_cost - local_price + local_return_tax
 *            - profit_local_shipmentfee - profit_marketfee - profit_vat
 *            - profit_companytax - profit_customstax - profit_exchangelost
 *            - profit_lostrate - profit_otherfee
 *   profitrate = profit/principal（principal≠0，2 位 HALF_UP）
 *   refundrate = refundorder/ordernum（2 位 HALF_UP）
 *   avgprice = salenum=0 ? 0 : principal/salenum
 * - 流量：sessionPercentage/pageViewsPercentage/buyBoxPercentage/unitSessionPercentage
 *   为 SP-API 报表直采字段，无派生公式（AmzProductPageviewsServiceImpl FILE_HEADER 直映射）。
 *
 * 红线：
 * - 所有分母为 0 / 数据缺失按 Wimoor 口径处理（null 或 Wimoor 实证哨兵），不臆造业务值。
 * - 利润公式中的成本/税费/本地费用项在本项目口径未拍板（见 profit-report.ts），
 *   因此 buildProfitMetrics 允许「只传入已确认项」；未传的扣减项按 Wimoor 公式仍参与，
 *   但调用方须通过 pendingSources 明确标注哪些扣减项缺真实数据，不静默补 0 伪装完整利润。
 * - 比率精度对齐 Wimoor：利润类 2 位 HALF_UP；广告类保留 6 位小数字符串保真。
 */

/** 比率口径来源标记，供展示层审计。 */
export type MetricBasis = {
  formula: string;
  source: string;
  /** 是否使用了 Wimoor 实证的哨兵/特殊分支 */
  specialCase?: string;
};

const HALF_UP_2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const dec = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
};
const fmt6 = (n: number): string => {
  const r = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(r, -0) ? "0" : String(r);
};

/** Wimoor ACOS 特殊分支哨兵（Mapper.xml:213-217）：cost>0 且 sales=0。 */
export const WIMOOR_ACOS_SENTINEL = 10_000_000_000;

export type AdsAggregate = {
  cost: number | string;
  clicks: number | string;
  impressions: number | string;
  attributedSales7d: number | string;
  attributedConversions7d: number | string;
};

export type AdsMetrics = {
  CTR: string | null;
  avgcost: string | null;
  ACOS: string | null;
  ROAS: string | null;
  CSRT: string | null;
  acosSpecial: boolean;
};

export const ADS_METRIC_BASIS: Record<keyof Omit<AdsMetrics, "acosSpecial">, MetricBasis> = {
  CTR: { formula: "sum(clicks)/sum(impressions)", source: "AmzAdvReportTargetQueryMapper.xml:212" },
  avgcost: { formula: "sum(cost)/sum(clicks)", source: "AmzAdvReportTargetQueryMapper.xml:211" },
  ACOS: { formula: "cost>0 且 sales=0 → 10000000000；否则 sum(cost)/sum(attributedSales7d)", source: "AmzAdvReportTargetQueryMapper.xml:213-217", specialCase: "Wimoor 哨兵值 10000000000" },
  ROAS: { formula: "sum(attributedSales7d)/sum(cost)", source: "AmzAdvReportTargetQueryMapper.xml:218-219" },
  CSRT: { formula: "sum(attributedConversions7d)/sum(clicks)", source: "AmzAdvReportTargetQueryMapper.xml:220-221" },
};

/**
 * 广告派生指标（对齐 Wimoir SQL 口径）。
 * 分母为 0 时 CTR/avgcost/ROAS/CSRT 返回 null（不臆造）；ACOS 走 Wimoor 特殊分支。
 */
export function buildAdsMetrics(a: AdsAggregate): AdsMetrics {
  const cost = dec(a.cost);
  const clicks = dec(a.clicks);
  const impressions = dec(a.impressions);
  const sales = dec(a.attributedSales7d);
  const conv = dec(a.attributedConversions7d);

  // ACOS：Wimoor 特殊分支优先（cost>0 且 sales=0 → 哨兵）；否则分母为 0 → null。
  let ACOS: string | null = null;
  let acosSpecial = false;
  if (cost > 0 && sales === 0) {
    ACOS = String(WIMOOR_ACOS_SENTINEL);
    acosSpecial = true;
  } else if (sales !== 0) {
    ACOS = fmt6(cost / sales);
  }

  return {
    CTR: impressions !== 0 ? fmt6(clicks / impressions) : null,
    avgcost: clicks !== 0 ? fmt6(cost / clicks) : null,
    ACOS,
    ROAS: cost !== 0 ? fmt6(sales / cost) : null,
    CSRT: clicks !== 0 ? fmt6(conv / clicks) : null,
    acosSpecial,
  };
}

/** 利润公式的 8 类平台费用 + 主本金（Wimoor setincome 组成）。 */
export type SettlementIncomeParts = {
  principal: number | string;
  commission?: number | string;
  fbafee?: number | string;
  refund?: number | string;
  otherfee?: number | string;
  tax?: number | string;
  shipping?: number | string;
  promotion?: number | string;
};

/** 利润追加扣减项（Wimoor profit 公式，口径未拍板时可由调用方标注缺失）。 */
export type ProfitDeductions = {
  local_other_cost?: number | string;
  local_price?: number | string;
  local_return_tax?: number | string;
  profit_local_shipmentfee?: number | string;
  profit_marketfee?: number | string;
  profit_vat?: number | string;
  profit_companytax?: number | string;
  profit_customstax?: number | string;
  profit_exchangelost?: number | string;
  profit_lostrate?: number | string;
  profit_otherfee?: number | string;
};

export type ProfitMetrics = {
  /** 店铺结算 = 8 类之和（Wimoor setincome） */
  setincome: string;
  /** 结算口径毛利（本层保守值，仅扣已传入的真实扣减项） */
  profit: string;
  /** 毛利率 profit/principal，principal=0 → null */
  profitrate: string | null;
  /** 平均售价 principal/salenum，salenum=0 → "0"（Wimoor 口径） */
  avgprice: string;
  /** 退款率 refundorder/ordernum，2 位 HALF_UP；ordernum=0 → null */
  refundrate: string | null;
  /** 未传入真实数据的扣减项（调用方必须展示，避免伪装完整利润） */
  missingDeductions: string[];
};

export const PROFIT_METRIC_BASIS: MetricBasis = {
  formula: "setincome=Σ(principal+commission+fbafee+refund+otherfee+tax+shipping+promotion); profit=setincome−Σ(扣减项); profitrate=profit/principal(2位HALF_UP); refundrate=refundorder/ordernum(2位HALF_UP); avgprice=salenum=0?0:principal/salenum",
  source: "AmzSettlementReportServiceImpl.handlerSettlementSKURowData:1739-1762; AmzSettlementSummarySkuMapper.xml:242,298-300",
};

const DEDUCTION_KEYS: Array<keyof ProfitDeductions> = [
  "local_other_cost", "local_price", "profit_local_shipmentfee", "profit_marketfee",
  "profit_vat", "profit_companytax", "profit_customstax", "profit_exchangelost",
  "profit_lostrate", "profit_otherfee",
];

/**
 * 利润派生指标（对齐 Wimoor 源码公式）。
 *
 * 关键诚实性：Wimoor 的 profit 会减去全部 11 项成本/税费/本地费用。本项目中这些项大多
 * 口径未拍板（§6.4）且无真实数据。本函数只对「调用方实际传入」的扣减项做扣减，并把未传的
 * 项列入 missingDeductions——绝不静默按 0 处理后再展示成"完整利润"。
 * local_return_tax 在 Wimoor 公式中是「加项」（退税），单独处理。
 */
export function buildProfitMetrics(
  income: SettlementIncomeParts,
  deductions: ProfitDeductions = {},
  volume: { salenum?: number | string; ordernum?: number | string; refundorder?: number | string } = {},
): ProfitMetrics {
  const setincome =
    dec(income.principal) + dec(income.commission) + dec(income.fbafee) + dec(income.refund) +
    dec(income.otherfee) + dec(income.tax) + dec(income.shipping) + dec(income.promotion);

  let profit = setincome + dec(deductions.local_return_tax); // 退税是加项
  const missingDeductions: string[] = [];
  for (const key of DEDUCTION_KEYS) {
    if (deductions[key] === undefined) missingDeductions.push(key);
    else profit -= dec(deductions[key]);
  }

  const principal = dec(income.principal);
  const salenum = dec(volume.salenum);
  const ordernum = dec(volume.ordernum);

  return {
    setincome: fmt6(setincome),
    profit: fmt6(profit),
    profitrate: principal !== 0 ? String(HALF_UP_2(profit / principal)) : null,
    avgprice: salenum === 0 ? "0" : fmt6(principal / salenum),
    refundrate: ordernum !== 0 ? String(HALF_UP_2(dec(volume.refundorder) / ordernum)) : null,
    missingDeductions,
  };
}

/** 流量比率字段口径：Wimoor 为报表直采，本项目从原始行 Json 提取（见 wimoor-field-extract）。 */
export const TRAFFIC_RATE_BASIS: MetricBasis = {
  formula: "sessionPercentage/pageViewsPercentage/buyBoxPercentage/unitSessionPercentage 为 SP-API 报表直采，非派生",
  source: "AmzProductPageviewsServiceImpl.java:109-139 (FILE_HEADER 直映射)",
};
