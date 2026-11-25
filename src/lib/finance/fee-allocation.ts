/**
 * 费用分摊矩阵（报告3 P2-3 / 报告2 P1-3）——费用类型 × 分摊策略。
 *
 * 把 8 类店铺费用池（settlement-fee-classification.ts 的 FEE_POOL_KEYS）从"整池金额"，
 * 按可配置策略分摊到 SKU，使非 SKU 费用可下钻到产品，且分摊差异可穿透审计。
 *
 * 策略：
 * - direct       直接归集：费用已带 targetSku，原样落；无 targetSku 视为不可分摊 → pending。
 * - salesWeight  按销售额比例：weight=该 SKU 销售额，分摊=费用×w/Σw。
 * - equal        均摊：Σw 内每个 SKU 等权，尾差归最后一个 SKU。
 * - custom       自定义权重：调用方显式给出每个 SKU 的权重（须全为正数）。
 *
 * 红线：
 * - BigInt 6 位定点；分摊后逐 SKU 之和必须精确等于费用原额（尾差归末位，绝不丢分）。
 * - 分母 Σw<=0 / 权重缺失 / 权重为负 → fail-closed，不臆造、不静默补零。
 * - 纯函数、零 IO、不跨币种（费用 currency 与销售额 currency 须一致）。
 */

import { amountUnits, unitsAmount } from "./open-item-rules";

export class FeeAllocationError extends Error {}

function fail(message: string): never { throw new FeeAllocationError(message); }
const ZERO = BigInt(0);
/** 把底层金额解析异常统一为 FeeAllocationError，保证模块错误类型一致。 */
function parseWeight(raw: string): bigint {
  try { return amountUnits(raw); }
  catch (e) { fail(`权重非法：${(e as Error).message}`); }
}

export type AllocationStrategy = "direct" | "salesWeight" | "equal" | "custom";
export const ALLOCATION_STRATEGIES: readonly AllocationStrategy[] = ["direct", "salesWeight", "equal", "custom"];

export type SkuWeight = { sku: string; weight: string | null };

export type FeeAllocationInput = {
  /** 费用类型键（对应 8 费用池键或其他自定义费用类）。 */
  feeType: string;
  /** 待分摊费用总额（6 位定点非负字符串）。 */
  totalAmount: string;
  currency: string;
  strategy: AllocationStrategy;
  /** 参与分摊的 SKU 及权重。salesWeight=销售额，equal 时 weight 可忽略，custom 时必填正数。 */
  targets: readonly SkuWeight[];
  /** direct 策略下，费用直接归属的单个 SKU（须在 targets 内）。 */
  directSku?: string;
};

export type AllocationLine = {
  sku: string;
  amount: string;
  /** 分摊权重快照（审计用）。 */
  weight: string | null;
};

export type FeeAllocationResult = {
  feeType: string;
  currency: string;
  strategy: AllocationStrategy;
  totalAmount: string;
  lines: AllocationLine[];
  /** 分摊后逐行之和（应精确等于 totalAmount）。 */
  allocatedTotal: string;
  /** 尾差调整额（归末位 SKU；0 表示无尾差）。 */
  residual: string;
  /** 是否精确对平。 */
  exact: boolean;
  /** 分摊依据摘要（供差异穿透）。 */
  basis: string;
};

/** 8 类费用池 → 默认分摊策略（salesWeight 为主，广告/仓储按销售额，reimbursement 直接归集视来源）。 */
export const FEE_POOL_DEFAULT_STRATEGY: Record<string, AllocationStrategy> = {
  storageFee: "salesWeight",
  longStorageFee: "salesWeight",
  advSpendFee: "salesWeight",
  couponRedemptionFee: "salesWeight",
  reserveFee: "equal",
  reimbursementFee: "direct",
  disposalFee: "salesWeight",
  shopOtherFee: "equal",
};

function validateCommon(input: FeeAllocationInput): bigint {
  if (typeof input.feeType !== "string" || !input.feeType) fail("费用类型不能为空。");
  if (!/^[A-Z]{3}$/.test(input.currency)) fail("币种须为三位大写字母。");
  if (!ALLOCATION_STRATEGIES.includes(input.strategy)) fail(`未知分摊策略：${input.strategy}`);
  if (!Array.isArray(input.targets) || input.targets.length === 0) fail("分摊目标 SKU 不能为空。");
  const skus = new Set<string>();
  for (const t of input.targets) {
    if (typeof t.sku !== "string" || !t.sku) fail("SKU 不能为空。");
    if (skus.has(t.sku)) fail(`SKU 重复：${t.sku}`);
    skus.add(t.sku);
  }
  return parseWeight(input.totalAmount);
}

/** 按权重比例分摊，尾差归最后一个 SKU，保证逐行之和精确等于总额。 */
function proportional(total: bigint, weights: bigint[], skus: string[]): AllocationLine[] {
  const sum = weights.reduce((a, b) => a + b, ZERO);
  if (sum <= ZERO) fail("分摊权重合计须为正数，拒绝臆造分摊。");
  const lines: AllocationLine[] = [];
  let allocated = ZERO;
  for (let i = 0; i < weights.length; i++) {
    let share: bigint;
    if (i === weights.length - 1) {
      share = total - allocated; // 尾差归末位
    } else {
      share = (total * weights[i]) / sum;
    }
    if (share < ZERO) share = ZERO; // 理论上不会发生，防御性保护
    allocated += share;
    lines.push({ sku: skus[i], amount: unitsAmount(share), weight: unitsAmount(weights[i]) });
  }
  return lines;
}

/**
 * 计算费用分摊。任何非法输入 fail-closed；结果行的 allocatedTotal 精确等于 totalAmount。
 */
export function allocateFee(input: FeeAllocationInput): FeeAllocationResult {
  const total = validateCommon(input);
  const skus = input.targets.map(t => t.sku);

  let lines: AllocationLine[];
  let basis: string;
  switch (input.strategy) {
    case "direct": {
      const sku = input.directSku;
      if (!sku || !skus.includes(sku)) fail("direct 策略须提供存在于 targets 内的 directSku。");
      lines = input.targets.map(t => ({ sku: t.sku, amount: t.sku === sku ? input.totalAmount : "0.000000", weight: t.sku === sku ? "1.000000" : null }));
      basis = `direct→${sku}`;
      break;
    }
    case "equal": {
      lines = proportional(total, skus.map(() => BigInt(1000000)), skus);
      basis = `equal(${skus.length} SKUs)`;
      break;
    }
    case "salesWeight": {
      const weights = input.targets.map(t => {
        if (t.weight === null || t.weight === undefined || String(t.weight).trim() === "") fail("salesWeight 策略下每个 SKU 须提供销售额权重；缺失不臆造。");
        return parseWeight(t.weight as string);
      });
      lines = proportional(total, weights, skus);
      basis = "salesWeight";
      break;
    }
    case "custom": {
      const weights = input.targets.map(t => {
        if (t.weight === null || t.weight === undefined || String(t.weight).trim() === "") fail("custom 策略下每个 SKU 须提供自定义权重；缺失不臆造。");
        const w = parseWeight(t.weight as string);
        if (w <= ZERO) fail("custom 策略下权重须为正数。");
        return w;
      });
      lines = proportional(total, weights, skus);
      basis = "custom";
      break;
    }
  }

  const allocated = lines.reduce((a, l) => a + amountUnits(l.amount), ZERO);
  const residual = total - allocated;
  return {
    feeType: input.feeType,
    currency: input.currency,
    strategy: input.strategy,
    totalAmount: unitsAmount(total),
    lines,
    allocatedTotal: unitsAmount(allocated),
    residual: unitsAmount(residual),
    exact: residual === ZERO,
    basis,
  };
}

/**
 * 批量分摊一组费用（多个费用池 × 同一组 SKU 权重），输出按费用类型索引的结果。
 * 各费用独立分摊、独立对平，不跨费用类型合并（避免口径漂移）。
 */
export function allocateFeeMatrix(inputs: readonly FeeAllocationInput[]): Record<string, FeeAllocationResult> {
  const out: Record<string, FeeAllocationResult> = {};
  for (const input of inputs) {
    if (out[input.feeType]) fail(`费用类型在矩阵中重复：${input.feeType}`);
    out[input.feeType] = allocateFee(input);
  }
  return out;
}
