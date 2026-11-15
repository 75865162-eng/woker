/**
 * 功能补全域的纯规则层：只做解析、换算与判定，不碰数据库。
 * 金额一律按 6 位定点（与采购/财务域一致），内部用微单位整数运算，避免浮点噪声。
 */
import { WmsInputError } from '@/lib/wms/rules';

export const micro = (value: number) => Math.round(value * 1_000_000);
export const fromMicro = (value: number) => Math.round(value) / 1_000_000;
export const addMoney = (...values: number[]) => fromMicro(values.reduce((sum, item) => sum + micro(item), 0));
export const mulMoney = (value: number, factor: number) => fromMicro(micro(value) * factor);
export const roundMoney = (value: number) => fromMicro(micro(value));

export function requireMoney(value: unknown, label: string, options: { min?: number; max?: number } = {}) {
  const raw = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new WmsInputError(`${label}必须是数字。`);
  const min = options.min ?? 0;
  const max = options.max ?? 1_000_000_000;
  if (raw < min || raw > max) throw new WmsInputError(`${label}须在 ${min} - ${max} 之间。`);
  return roundMoney(raw);
}

export function requireInt(value: unknown, label: string, options: { min?: number; max?: number } = {}) {
  const raw = typeof value === 'string' ? Number(value.trim()) : value;
  const min = options.min ?? 0;
  const max = options.max ?? 2_147_483_647;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < min || raw > max) {
    throw new WmsInputError(`${label}必须是 ${min} - ${max} 的整数。`);
  }
  return raw;
}

export function requireEnum<T extends string>(value: unknown, label: string, allowed: readonly T[], fallback?: T): T {
  if ((value === undefined || value === null || value === '') && fallback) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new WmsInputError(`${label}只能是 ${allowed.join(' / ')}。`);
  return value as T;
}

export function requireDate(value: unknown, label: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new WmsInputError(`${label}格式须为 YYYY-MM-DD。`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new WmsInputError(`${label}不是有效日期。`);
  return parsed;
}

export function optionalDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  return requireDate(value, label);
}

export const dayKey = (value: Date) => value.toISOString().slice(0, 10);

// ───────────────────────────── 计算器：FBA 费用与利润 ─────────────────────────────

export type RateCard = {
  /** 佣金比例，万分比：1500 = 15% */
  referralRateBp: number;
  /** 单件最低佣金 */
  minReferral: number;
  /** 标准尺寸首重（盎司）内的分段费率 */
  standardTiers: Array<{ maxOz: number; fee: number }>;
  /** 标准尺寸超出首重后，每 4 盎司加收 */
  standardPerStepFee: number;
  /** 大件基础费（首磅）与续重 */
  oversizeBase: number;
  oversizePerLb: number;
  /** 体积重除数（英寸³ / lb） */
  dimDivisor: number;
  /** 月度仓储费（每立方英尺） */
  storagePerCubicFoot: number;
};

/** 默认费率卡：美国站标准尺寸公开费率口径，仅作测算基线，可在页面按实际费率改。 */
export const defaultRateCard: RateCard = {
  referralRateBp: 1500,
  minReferral: 0.3,
  standardTiers: [
    { maxOz: 4, fee: 3.06 },
    { maxOz: 8, fee: 3.15 },
    { maxOz: 12, fee: 3.24 },
    { maxOz: 16, fee: 3.33 },
  ],
  standardPerStepFee: 0.08,
  oversizeBase: 9.61,
  oversizePerLb: 0.38,
  dimDivisor: 139,
  storagePerCubicFoot: 0.87,
};

export type FeeInput = {
  /** 售价 */
  price: number;
  /** 买家运费 */
  shipping: number;
  /** 单件重量（盎司） */
  weightOz: number;
  /** 长宽高（英寸），任一为 0 视为不计算体积重 */
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  /** 是否大件（超标准尺寸） */
  oversize: boolean;
  /** 佣金覆盖比例（万分比），默认取费率卡 */
  referralRateBp?: number;
  /** 月度周转天数，用于摊仓储费 */
  storageDays?: number;
  rateCard?: Partial<RateCard>;
};

export type FeeResult = {
  revenue: number;
  referralFee: number;
  fulfillmentFee: number;
  storageFee: number;
  totalFee: number;
  netProceeds: number;
  billableWeightOz: number;
  dimensionalWeightOz: number;
  sizeTier: 'STANDARD' | 'OVERSIZE';
  breakdown: Array<{ label: string; amount: number; note: string }>;
};

function resolveRateCard(override?: Partial<RateCard>): RateCard {
  if (!override) return defaultRateCard;
  return {
    ...defaultRateCard,
    ...override,
    standardTiers: override.standardTiers?.length ? override.standardTiers : defaultRateCard.standardTiers,
  };
}

function fulfillmentFeeOf(weightOz: number, oversize: boolean, card: RateCard) {
  if (oversize) {
    const pounds = Math.max(1, weightOz / 16);
    return addMoney(card.oversizeBase, mulMoney(card.oversizePerLb, pounds - 1));
  }
  const tier = card.standardTiers.find(item => weightOz <= item.maxOz);
  if (tier) return roundMoney(tier.fee);
  const firstTierMax = card.standardTiers[card.standardTiers.length - 1]?.maxOz ?? 16;
  const lastFee = card.standardTiers[card.standardTiers.length - 1]?.fee ?? 3.33;
  const steps = Math.ceil((weightOz - firstTierMax) / 4);
  return addMoney(lastFee, mulMoney(card.standardPerStepFee, steps));
}

export function quoteFbaFee(input: FeeInput): FeeResult {
  const card = resolveRateCard(input.rateCard);
  const revenue = addMoney(input.price, input.shipping);
  const rateBp = input.referralRateBp ?? card.referralRateBp;
  const referralFee = Math.max(card.minReferral, mulMoney(revenue, rateBp / 10_000));
  const dimWeightOz = input.lengthIn > 0 && input.widthIn > 0 && input.heightIn > 0
    ? Math.ceil((input.lengthIn * input.widthIn * input.heightIn) / card.dimDivisor * 16)
    : 0;
  const billableWeightOz = Math.max(input.weightOz, dimWeightOz);
  const fulfillmentFee = fulfillmentFeeOf(billableWeightOz, input.oversize, card);
  const cubicFeet = input.lengthIn > 0 && input.widthIn > 0 && input.heightIn > 0
    ? (input.lengthIn * input.widthIn * input.heightIn) / 1728
    : 0;
  const months = (input.storageDays ?? 30) / 30;
  const storageFee = mulMoney(mulMoney(cubicFeet, card.storagePerCubicFoot), months);
  const totalFee = addMoney(referralFee, fulfillmentFee, storageFee);
  return {
    revenue,
    referralFee,
    fulfillmentFee,
    storageFee,
    totalFee,
    netProceeds: addMoney(revenue, -totalFee),
    billableWeightOz,
    dimensionalWeightOz: dimWeightOz,
    sizeTier: input.oversize ? 'OVERSIZE' : 'STANDARD',
    breakdown: [
      { label: '佣金', amount: referralFee, note: `按 ${(rateBp / 100).toFixed(2)}% 计，最低 ${card.minReferral}` },
      { label: '配送费', amount: fulfillmentFee, note: `${input.oversize ? '大件' : '标准尺寸'} · 计费重 ${billableWeightOz} oz` },
      { label: '仓储费', amount: storageFee, note: `${cubicFeet.toFixed(3)} ft³ × ${card.storagePerCubicFoot}/ft³ × ${months.toFixed(2)} 月` },
    ],
  };
}

export type ProfitInput = FeeInput & {
  /** 采购成本 */
  unitCost: number;
  /** 头程/入仓运费（单件） */
  inboundCost: number;
  /** 广告费（单件） */
  adCost: number;
  /** 其它费用（单件） */
  otherCost: number;
  /** 退货率（万分比），按比例摊掉毛利 */
  returnRateBp?: number;
};

export type ProfitResult = FeeResult & {
  costTotal: number;
  profit: number;
  marginBp: number;
  roiBp: number;
  breakevenPrice: number;
  targetPrice: number;
  targetMarginBp: number;
};

export function quoteProfit(input: ProfitInput): ProfitResult {
  const fee = quoteFbaFee(input);
  const costTotal = addMoney(input.unitCost, input.inboundCost, input.adCost, input.otherCost);
  const returnLoss = mulMoney(fee.netProceeds, (input.returnRateBp ?? 0) / 10_000);
  const profit = addMoney(fee.netProceeds, -costTotal, -returnLoss);
  const marginBp = fee.revenue > 0 ? Math.round((profit / fee.revenue) * 10_000) : 0;
  const roiBp = costTotal > 0 ? Math.round((profit / costTotal) * 10_000) : 0;
  const card = resolveRateCard(input.rateCard);
  const rateBp = input.referralRateBp ?? card.referralRateBp;
  const returnRate = (input.returnRateBp ?? 0) / 10_000;
  // 保本：净收款覆盖成本与退货损失，退货损失按净收款比例摊。
  const costOnly = addMoney(input.unitCost, input.inboundCost, input.adCost, input.otherCost);
  const platformFee = addMoney(fee.fulfillmentFee, fee.storageFee);
  const revenueFactor = 1 - rateBp / 10_000;
  const denominator = revenueFactor * (1 - returnRate);
  const breakevenPrice = denominator <= 0 ? 0 : roundMoney((costOnly + mulMoney(platformFee, 1 - returnRate)) / denominator);
  return { ...fee, costTotal, profit, marginBp, roiBp, breakevenPrice, targetPrice: breakevenPrice, targetMarginBp: marginBp };
}

/** 反算：给定目标毛利率（万分比），需要多少售价。退货损失按净收款比例同步进分母。 */
export function priceForMargin(input: ProfitInput, targetMarginBp: number): number {
  const card = resolveRateCard(input.rateCard);
  const rateBp = input.referralRateBp ?? card.referralRateBp;
  const returnRate = (input.returnRateBp ?? 0) / 10_000;
  const base = quoteProfit({ ...input, price: 0, shipping: 0 });
  const platformFee = addMoney(base.fulfillmentFee, base.storageFee);
  const revenueFactor = 1 - rateBp / 10_000;
  const denominator = revenueFactor * (1 - returnRate) - targetMarginBp / 10_000;
  if (denominator <= 0) return 0;
  return roundMoney((base.costTotal + mulMoney(platformFee, 1 - returnRate)) / denominator);
}

// ───────────────────────────── 评论与绩效 ─────────────────────────────

export function sentimentOf(rating: number): 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' {
  if (rating >= 4) return 'POSITIVE';
  if (rating === 3) return 'NEUTRAL';
  return 'NEGATIVE';
}

export type PerformanceInput = {
  totalOrders: number;
  orderDefectRateBp: number;
  lateShipmentRateBp: number;
  cancellationRateBp: number;
  validTrackingRateBp: number;
  negativeFeedbackRateBp: number;
};

/** 亚马逊卖家绩效公开阈值，仅做提示，不代替账户健康页面。 */
export const performanceThresholds = {
  orderDefectRateBp: 100,
  lateShipmentRateBp: 400,
  cancellationRateBp: 250,
  validTrackingRateBp: 9500,
  negativeFeedbackRateBp: 100,
} as const;

export function performanceVerdict(input: PerformanceInput) {
  const flags: Array<{ metric: string; valueBp: number; thresholdBp: number; ok: boolean; rule: string }> = [
    { metric: '订单缺陷率', valueBp: input.orderDefectRateBp, thresholdBp: performanceThresholds.orderDefectRateBp, ok: input.orderDefectRateBp <= performanceThresholds.orderDefectRateBp, rule: '≤ 1%' },
    { metric: '迟发率', valueBp: input.lateShipmentRateBp, thresholdBp: performanceThresholds.lateShipmentRateBp, ok: input.lateShipmentRateBp <= performanceThresholds.lateShipmentRateBp, rule: '≤ 4%' },
    { metric: '取消率', valueBp: input.cancellationRateBp, thresholdBp: performanceThresholds.cancellationRateBp, ok: input.cancellationRateBp <= performanceThresholds.cancellationRateBp, rule: '≤ 2.5%' },
    { metric: '有效追踪率', valueBp: input.validTrackingRateBp, thresholdBp: performanceThresholds.validTrackingRateBp, ok: input.validTrackingRateBp >= performanceThresholds.validTrackingRateBp, rule: '≥ 95%' },
    { metric: '差评率', valueBp: input.negativeFeedbackRateBp, thresholdBp: performanceThresholds.negativeFeedbackRateBp, ok: input.negativeFeedbackRateBp <= performanceThresholds.negativeFeedbackRateBp, rule: '≤ 1%' },
  ];
  return { flags, ok: flags.every(item => item.ok), breached: flags.filter(item => !item.ok).map(item => item.metric) };
}

// ───────────────────────────── 跟卖与调价 ─────────────────────────────

export type RepricingRuleLike = {
  strategy: 'MATCH_LOWEST' | 'BEAT_LOWEST' | 'HOLD';
  floorPrice: number;
  ceilingPrice: number;
  stepAmount: number;
  minMarginBp: number;
};

export type PriceSuggestion = { price: number; reason: string; blocked: boolean };

/**
 * 建议价三原则：不破地板价、不超天花板价、不低于最低毛利；
 * 任何一步触碰边界都返回 blocked=true 并说明原因，交给人工决定，不静默改价。
 */
export function suggestPrice(input: {
  myPrice: number;
  buyBoxPrice: number;
  lowestCompetitorPrice: number;
  rule: RepricingRuleLike;
  unitCost?: number;
}): PriceSuggestion {
  const { rule } = input;
  if (rule.strategy === 'HOLD') return { price: roundMoney(input.myPrice), reason: '规则为保持现价', blocked: false };
  const reference = input.lowestCompetitorPrice > 0 ? input.lowestCompetitorPrice : input.buyBoxPrice;
  if (reference <= 0) return { price: roundMoney(input.myPrice), reason: '缺少竞争价，保持现价', blocked: false };
  const target = rule.strategy === 'BEAT_LOWEST' ? addMoney(reference, -rule.stepAmount) : roundMoney(reference);
  const marginFloor = input.unitCost && rule.minMarginBp > 0
    ? roundMoney(input.unitCost / (1 - rule.minMarginBp / 10_000))
    : 0;
  const effectiveFloor = Math.max(rule.floorPrice, marginFloor);
  if (target < effectiveFloor) {
    return {
      price: roundMoney(effectiveFloor),
      reason: marginFloor > rule.floorPrice ? `竞争价低于毛利底线，止于毛利底线 ${effectiveFloor}` : `竞争价低于地板价，止于 ${effectiveFloor}`,
      blocked: true,
    };
  }
  if (target > rule.ceilingPrice) {
    return { price: roundMoney(rule.ceilingPrice), reason: `目标价超过天花板，止于 ${rule.ceilingPrice}`, blocked: true };
  }
  if (Math.abs(target - input.myPrice) < 0.01) return { price: roundMoney(input.myPrice), reason: '与现价一致，无需调整', blocked: false };
  return {
    price: roundMoney(target),
    reason: rule.strategy === 'BEAT_LOWEST' ? '低于最低竞争价一个步长' : '对齐最低竞争价',
    blocked: false,
  };
}

// ───────────────────────────── 销售计划与预测 ─────────────────────────────

/** 预测 = 历史日均 × 天数 × 季节系数（万分比），向下取整，避免虚高。 */
export function forecastQty(dailyAvg: number, days: number, seasonalityBp = 10_000): number {
  if (dailyAvg <= 0 || days <= 0) return 0;
  return Math.max(0, Math.floor(dailyAvg * days * (seasonalityBp / 10_000)));
}

export function planVariance(input: { targetQty: number; actualQty: number; forecastQty: number }) {
  const gap = input.actualQty - input.targetQty;
  return {
    gap,
    completionBp: input.targetQty > 0 ? Math.round((input.actualQty / input.targetQty) * 10_000) : 0,
    forecastGap: input.forecastQty - input.targetQty,
    verdict: input.targetQty === 0 ? 'NO_TARGET' : gap >= 0 ? 'ON_TRACK' : input.actualQty / input.targetQty >= 0.8 ? 'AT_RISK' : 'BEHIND',
  };
}

// ───────────────────────────── 税务 ─────────────────────────────

export function taxAmountOf(taxableAmount: number, taxRateBp: number) {
  return roundMoney((taxableAmount * taxRateBp) / 10_000);
}

export function taxPeriodOf(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ───────────────────────────── 采购协同 ─────────────────────────────

export type ExchangeLine = { sellerSku: string; quantity: number; replacementQty: number; note: string };

export function parseExchangeLines(value: unknown): ExchangeLine[] {
  if (!Array.isArray(value) || value.length === 0) throw new WmsInputError('换货单至少需要一行明细。');
  if (value.length > 200) throw new WmsInputError('换货单明细不能超过 200 行。');
  return value.map((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const sellerSku = typeof row.sellerSku === 'string' ? row.sellerSku.trim() : '';
    if (!sellerSku) throw new WmsInputError(`第 ${index + 1} 行缺少 SKU。`);
    return {
      sellerSku,
      quantity: requireInt(row.quantity, `第 ${index + 1} 行换货数量`, { min: 1 }),
      replacementQty: requireInt(row.replacementQty ?? row.quantity, `第 ${index + 1} 行补发数量`, { min: 0 }),
      note: typeof row.note === 'string' ? row.note.trim().slice(0, 200) : '',
    };
  });
}

/** 报价比价：有效报价里取单价最低者，价同取交期短者。 */
export function cheapestQuotation<T extends { unitPrice: number; leadTimeDays: number; id: string }>(rows: T[]) {
  return [...rows].sort((a, b) => a.unitPrice - b.unitPrice || a.leadTimeDays - b.leadTimeDays)[0] ?? null;
}
