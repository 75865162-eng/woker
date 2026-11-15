import { createHash } from "node:crypto";
import type { NormalizedDomainReportRow } from "./domain-reports";
import { amountUnits, unitsAmount } from "@/lib/finance/open-item-rules";
import { sumLedgerAmounts } from "@/lib/finance/amount-view";
import {
  FEE_POOL_KEYS,
  classifySettlementRow,
  settlementFeePool,
  buildDedupeKey,
  buildOverlapKey,
  distinctOrderKey,
  type FeePoolKey,
  type SettlementClassification,
  type SettlementAllocationScope,
} from "./settlement-fee-classification";

/**
 * Amazon 结算到 SKU 分摊 + 订单/退款/仓储费业务重叠去重（纯函数，零 IO）。
 *
 * 保留的上游语义（AmzSettlementSKUShareServiceImpl / 去重口径）：
 *  - SKU 级行只贡献本金基数，不进店铺级 8 类费用池（防同一笔既算本金又算分摊）。
 *  - 8 类池按 (amount_type, amount_description) 的 if/else 优先级归类，
 *    「其余 → otherfee」差额兜底。
 *  - rate = 本金占比优先（Σprincipal > 0.0001）/ 销量占比兜底 / 否则 0（NONE）。
 *  - 8 类费用 × rate，从剩余池扣减并封顶，正负费用都处理，禁止超分。
 *  - 尾差 8 类分别加回（不是净额）：MAX_PRINCIPAL_SKU 复刻「尾差归本金最大 SKU」。
 *  - 去重：同 overlapKey 的重复本金行记入 suppressedRowNumbers、
 *    COUNT(DISTINCT order_id) 只计一次；Refund/ItemPrice/Principal 单列 refund
 *    不冲减本金；Transfer of funds unsuccessful 行排除。
 *  - 先删后整批写回的幂等语义由 inputDigest / idempotencyKey 表达（本函数不落库）。
 *
 * 刻意改进（相对上游 floatValue / BigDecimal）：
 *  - 全程 six-decimal 定点 bigint（amountUnits / unitsAmount），禁止浮点运算。
 *  - rate 仅作 30 位小数 HALF_UP 的证据字符串；实际分摊用精确整数比例 +
 *    最大余数法（LARGEST_REMAINDER，移植自 cost-allocation L56-59），
 *    替代上游「尾差用 floatValue 比较」与 2 位小数舍入，保证 Σ分摊 == 池总额。
 *  - 三类对账任一失败 / 非法金额 / 跨币种 → 抛错且整批不产出 lines。
 *
 * 依赖仅：node:crypto、纯定点工具、本目录的分类纯函数与类型（import type 会在运行时擦除）。
 */

export type BasisType = "PRINCIPAL" | "SALES" | "NONE";
export type RemainderPolicy = "LARGEST_REMAINDER" | "MAX_PRINCIPAL_SKU";

export type AllocateSettlementOptions = SettlementAllocationScope & {
  settlementReportId?: string;
  algorithmVersion?: string;
  remainderPolicy?: RemainderPolicy;
  /** 本金占比启用阈值，默认 "0.0001"（上游 BigDecimal 0.0001）。 */
  principalThreshold?: string;
  /** 结算控制总额（如报告合计行 / Amazon 结算总额）；提供时 Σ原始行须与其一致。 */
  controlTotal?: string;
};

export type AllocationLine = {
  sku: string;
  sellerSku: string | null;
  businessDate: string | null;
  currency: string;
  basisAmount: string;
  rate: string;
  shareStorageFee: string;
  shareLongStorageFee: string;
  shareAdvSpendFee: string;
  shareCouponRedemptionFee: string;
  shareReserveFee: string;
  shareReimbursementFee: string;
  shareDisposalFee: string;
  shareShopOtherFee: string;
  isRemainderBearer: boolean;
  dedupeKey: string;
  overlapKey: string;
  classification: string;
  principalRowRefs: number[];
  feeRowRefs: Record<FeePoolKey, number[]>;
  suppressedRowNumbers: number[];
  dedupeEvidence: Record<string, unknown>;
};

export type AllocationHeader = {
  organizationId: string;
  workspaceId: string;
  settlementReportId: string;
  settlementId: string;
  currency: string;
  marketplaceId: string;
  basisType: BasisType;
  algorithmVersion: string;
  remainderPolicy: RemainderPolicy;
  inputDigest: string;
  idempotencyKey: string;
  requestHash: string;
  status: "STAGED";
  lineCount: number;
  inputRowCount: number;
};

export type AllocationReconciliation = {
  ok: boolean;
  currency: { ok: boolean; currency: string; distinct: string[] };
  allocationVsPool: {
    ok: boolean;
    pools: Record<FeePoolKey, { poolTotal: string; allocatedTotal: string; difference: string }>;
  };
  total: {
    ok: boolean;
    originalTotal: string;
    principalTotal: string;
    refundTotal: string;
    feePoolsTotal: string;
    /** 兜底 otherfee = Σ原始行 − Σ(本金 + 8 类 + refund)。 */
    otherfee: string;
    suppressedTotal: string;
    /** summaryData = Σ原始行 − Σ(本金 + 8 类 + refund + otherfee)，须为 0。 */
    summaryData: string;
    /** otherfee − suppressedTotal，须为 0（否则有行未被正确归类）。 */
    difference: string;
    controlTotal: string | null;
  };
  distinctOrderCount: number;
};

export type AllocationDedupeEvidence = {
  scope: SettlementAllocationScope;
  classifiedCounts: Record<SettlementClassification, number>;
  overlapGroups: Array<{ overlapKey: string; keptRowNumber: number; suppressedRowNumbers: number[] }>;
  suppressedRowNumbers: number[];
  excludedRowNumbers: number[];
  distinctOrderKeys: string[];
  distinctOrderCount: number;
};

export type SettlementAllocationResult = {
  header: AllocationHeader;
  lines: AllocationLine[];
  reconciliation: AllocationReconciliation;
  dedupeEvidence: AllocationDedupeEvidence;
};

// 项目 target 为 ES2017，禁用 bigint 字面量（如 0n），统一用 BigInt() 与现有代码一致。
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const RATE_SCALE = BigInt(10) ** BigInt(30);
const ZERO_RATE = `0.${"0".repeat(30)}`;
const DEFAULT_ALGORITHM_VERSION = "sku-share-1";
const DEFAULT_THRESHOLD = "0.0001";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 解析带符号的六位定点字符串为 bigint（复用 amountUnits 的严格十进制校验）。 */
function parseSignedUnits(value: string): bigint {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("结算行金额缺失或非法：须为最多六位小数的十进制字符串。");
  }
  const negative = value.startsWith("-");
  const magnitude = negative ? value.slice(1) : value;
  const units = amountUnits(magnitude); // 非法十进制（含 7 位小数、非数字）会抛 WmsError
  return negative ? -units : units;
}

/** report-formula.ts `rounded` 的 HALF_UP 定点除法（其未导出，此处等价复刻）。 */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === ZERO) throw new Error("报表公式除数为零。");
  const negative = numerator < ZERO !== denominator < ZERO;
  const a = numerator < ZERO ? -numerator : numerator;
  const b = denominator < ZERO ? -denominator : denominator;
  const value = (a + b / TWO) / b;
  return negative ? -value : value;
}

function formatRate(value: bigint): string {
  const negative = value < ZERO;
  const a = negative ? -value : value;
  return `${negative ? "-" : ""}${a / RATE_SCALE}.${String(a % RATE_SCALE).padStart(30, "0")}`;
}

function poolRecord<T>(fill: () => T): Record<FeePoolKey, T> {
  return Object.fromEntries(FEE_POOL_KEYS.map((key) => [key, fill()])) as Record<FeePoolKey, T>;
}

/**
 * 把单个（绝对）费用池按 weights 精确分摊到各 SKU，返回非负微单位与尾差承担标记。
 *  - LARGEST_REMAINDER：floor 后按余数降序、sku 升序逐个补 1 微单位（cost-allocation L56-59）。
 *  - MAX_PRINCIPAL_SKU：整个 leftover 归本金最大的 SKU（复刻上游 L525-529/L561-578）。
 * leftover = absPool − Σfloor，恒 < 行数，故 Number(leftover) 安全。
 */
function distributePool(
  absPool: bigint,
  weights: readonly bigint[],
  principals: readonly bigint[],
  skuKeys: readonly string[],
  policy: RemainderPolicy,
): { allocated: bigint[]; topups: bigint[] } {
  const n = weights.length;
  const topups = new Array<bigint>(n).fill(ZERO);
  const total = weights.reduce((sum, weight) => sum + weight, ZERO);
  if (total === ZERO || absPool === ZERO) {
    return { allocated: new Array<bigint>(n).fill(ZERO), topups };
  }
  const base = weights.map((weight) => (absPool * weight) / total);
  const remainder = weights.map((weight) => (absPool * weight) % total);
  const leftover = absPool - base.reduce((sum, value) => sum + value, ZERO);
  if (leftover > ZERO) {
    if (policy === "LARGEST_REMAINDER") {
      const ranked = weights
        .map((_, index) => index)
        .sort((i, j) =>
          remainder[i] !== remainder[j]
            ? remainder[i] > remainder[j]
              ? -1
              : 1
            : skuKeys[i] < skuKeys[j]
              ? -1
              : skuKeys[i] > skuKeys[j]
                ? 1
                : 0,
        );
      for (let k = 0; k < Number(leftover); k++) topups[ranked[k]] += ONE;
    } else {
      let best = 0;
      for (let i = 1; i < n; i++) {
        if (
          principals[i] > principals[best] ||
          (principals[i] === principals[best] && skuKeys[i] < skuKeys[best])
        ) best = i;
      }
      topups[best] = leftover;
    }
  }
  return { allocated: base.map((value, index) => value + topups[index]), topups };
}

type ClassifiedRow = { row: NormalizedDomainReportRow; classification: SettlementClassification; units: bigint };

type SkuAggregate = {
  principal: bigint;
  sales: bigint;
  sellerSku: string | null;
  businessDate: string | null;
  representativeRow: NormalizedDomainReportRow;
  principalRowRefs: number[];
  suppressedRowNumbers: number[];
  distinctOrderKeys: string[];
  overlapKeys: string[];
};

export function allocateSettlementToSku(
  rows: readonly NormalizedDomainReportRow[],
  options: AllocateSettlementOptions,
): SettlementAllocationResult {
  const algorithmVersion = options.algorithmVersion ?? DEFAULT_ALGORITHM_VERSION;
  const remainderPolicy = options.remainderPolicy ?? "LARGEST_REMAINDER";
  const thresholdText = options.principalThreshold ?? DEFAULT_THRESHOLD;
  const settlementReportId = options.settlementReportId ?? options.settlementId;
  if (!algorithmVersion.trim()) throw new Error("algorithmVersion 不能为空。");
  if (remainderPolicy !== "LARGEST_REMAINDER" && remainderPolicy !== "MAX_PRINCIPAL_SKU") {
    throw new Error("remainderPolicy 无效。");
  }
  const threshold = parseSignedUnits(thresholdText);

  const scope: SettlementAllocationScope = {
    organizationId: options.organizationId,
    workspaceId: options.workspaceId,
    settlementId: options.settlementId,
    currency: options.currency,
    marketplaceId: options.marketplaceId,
  };

  // ① 单一币种对账（跨币种整批拒绝，覆盖全部输入行）
  const distinctCurrencies = [
    ...new Set(
      rows
        .map((row) => row.currencyCode)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ].sort();
  const currencyOk =
    distinctCurrencies.length <= 1 && distinctCurrencies.every((value) => value === options.currency);

  // ② 分类
  const classified = rows.map((row) => ({ row, classification: classifySettlementRow(row) }));
  const excluded = classified.filter((entry) => entry.classification === "EXCLUDED");
  const nonExcluded = classified.filter((entry) => entry.classification !== "EXCLUDED");
  const classifiedCounts: Record<SettlementClassification, number> = {
    SKU_PRINCIPAL: 0,
    SKU_REFUND: 0,
    STORE_FEE: 0,
    EXCLUDED: excluded.length,
  };
  const parsed: ClassifiedRow[] = nonExcluded.map((entry) => {
    classifiedCounts[entry.classification]++;
    return {
      row: entry.row,
      classification: entry.classification,
      units: parseSignedUnits(entry.row.amountOriginal ?? ""),
    };
  });

  // Σ原始行：独立用 sumLedgerAmounts 复算一次，交叉校验定点累计
  const originalTotalString = sumLedgerAmounts(parsed.map((entry) => entry.row.amountOriginal as string));
  const originalTotalUnits = parsed.reduce((sum, entry) => sum + entry.units, ZERO);
  if (parseSignedUnits(originalTotalString) !== originalTotalUnits) {
    throw new Error("Σ原始行 两种定点复算不一致，整批拒绝。");
  }

  // ③ 去重：仅 SKU 级本金行按 overlapKey 分组，保留最小 rowNumber
  const principalRows = parsed.filter((entry) => entry.classification === "SKU_PRINCIPAL");
  const groups = new Map<string, ClassifiedRow[]>();
  for (const entry of principalRows) {
    const key = buildOverlapKey(entry.row, scope);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const keptPrincipal: ClassifiedRow[] = [];
  const suppressedPrincipal: ClassifiedRow[] = [];
  const overlapGroups: AllocationDedupeEvidence["overlapGroups"] = [];
  for (const [overlapKey, group] of groups) {
    const ordered = [...group].sort((a, b) => a.row.rowNumber - b.row.rowNumber);
    keptPrincipal.push(ordered[0]);
    for (let i = 1; i < ordered.length; i++) suppressedPrincipal.push(ordered[i]);
    overlapGroups.push({
      overlapKey,
      keptRowNumber: ordered[0].row.rowNumber,
      suppressedRowNumbers: ordered.slice(1).map((entry) => entry.row.rowNumber),
    });
  }

  // ④ 本金按 SKU 聚合；销量（quantity）作 SALES 分支兜底基数
  const bySku = new Map<string, SkuAggregate>();
  const suppressedBySku = new Map<string, number[]>();
  for (const entry of suppressedPrincipal) {
    const sku = entry.row.sellerSku;
    if (sku) {
      const list = suppressedBySku.get(sku) ?? [];
      list.push(entry.row.rowNumber);
      suppressedBySku.set(sku, list);
    }
  }
  for (const entry of keptPrincipal) {
    const sku = entry.row.sellerSku;
    if (!sku) throw new Error("SKU 级本金行缺少 sellerSku，整批拒绝。");
    const quantityText = entry.row.quantityOriginal;
    const sales = quantityText ? amountUnits(quantityText) : ZERO;
    const aggregate = bySku.get(sku) ?? {
      principal: ZERO,
      sales: ZERO,
      sellerSku: entry.row.sellerSku,
      businessDate: entry.row.businessDate,
      representativeRow: entry.row,
      principalRowRefs: [],
      suppressedRowNumbers: suppressedBySku.get(sku) ?? [],
      distinctOrderKeys: [],
      overlapKeys: [],
    };
    aggregate.principal += entry.units;
    aggregate.sales += sales;
    aggregate.principalRowRefs.push(entry.row.rowNumber);
    aggregate.distinctOrderKeys.push(distinctOrderKey(entry.row, scope));
    aggregate.overlapKeys.push(buildOverlapKey(entry.row, scope));
    bySku.set(sku, aggregate);
  }

  const principalTotalUnits = keptPrincipal.reduce((sum, entry) => sum + entry.units, ZERO);
  const suppressedTotalUnits = suppressedPrincipal.reduce((sum, entry) => sum + entry.units, ZERO);
  const refundTotalUnits = parsed
    .filter((entry) => entry.classification === "SKU_REFUND")
    .reduce((sum, entry) => sum + entry.units, ZERO);
  const salesTotalUnits = [...bySku.values()].reduce((sum, aggregate) => sum + aggregate.sales, ZERO);

  // ⑤ rate 分支：本金占比优先 / 销量占比兜底 / 否则 NONE
  let basisType: BasisType;
  if (principalTotalUnits > threshold) basisType = "PRINCIPAL";
  else if (salesTotalUnits > ZERO) basisType = "SALES";
  else basisType = "NONE";

  const skuEntries = [...bySku.entries()].sort(([a], [b]) => a.localeCompare(b));
  const skuKeys = skuEntries.map(([sku]) => sku);
  const principals = skuEntries.map(([, aggregate]) => aggregate.principal);
  const weights = skuEntries.map(([, aggregate]) =>
    basisType === "PRINCIPAL" ? aggregate.principal : basisType === "SALES" ? aggregate.sales : ZERO,
  );
  if (weights.some((weight) => weight < ZERO)) throw new Error("分摊基数含负值，整批拒绝。");
  const totalWeight = weights.reduce((sum, weight) => sum + weight, ZERO);
  const rates = weights.map((weight) =>
    totalWeight > ZERO ? formatRate(divRoundHalfUp(weight * RATE_SCALE, totalWeight)) : ZERO_RATE,
  );

  // ⑥ 8 类池（正负费用都进各自池；SKU 级行不进池）
  const poolUnits = poolRecord(() => ZERO);
  const feeRowRefsByPool = poolRecord<number[]>(() => []);
  for (const entry of parsed) {
    if (entry.classification !== "STORE_FEE") continue;
    const pool = settlementFeePool(entry.row);
    poolUnits[pool] += entry.units;
    feeRowRefsByPool[pool].push(entry.row.rowNumber);
  }

  // ⑦ 8 类 × rate + 剩余池封顶 → 尾差（8 类分别加回，不是净额）
  const sharesByLine = poolRecord<bigint[]>(() => []);
  const bearerFlags = skuKeys.map(() => false);
  for (const pool of FEE_POOL_KEYS) {
    const signedPool = poolUnits[pool];
    const absPool = signedPool < ZERO ? -signedPool : signedPool;
    const sign = signedPool < ZERO ? -ONE : ONE;
    const { allocated, topups } = distributePool(absPool, weights, principals, skuKeys, remainderPolicy);
    sharesByLine[pool] = allocated.map((value) => value * sign);
    for (let i = 0; i < topups.length; i++) if (topups[i] > ZERO) bearerFlags[i] = true;
  }

  // ⑧ 三类对账
  const allocationPools = poolRecord<{ poolTotal: string; allocatedTotal: string; difference: string }>(() => ({
    poolTotal: "",
    allocatedTotal: "",
    difference: "",
  }));
  let allocationOk = true;
  for (const pool of FEE_POOL_KEYS) {
    const allocatedTotal = sharesByLine[pool].reduce((sum, value) => sum + value, ZERO);
    const difference = allocatedTotal - poolUnits[pool];
    if (difference !== ZERO) allocationOk = false;
    allocationPools[pool] = {
      poolTotal: unitsAmount(poolUnits[pool]),
      allocatedTotal: unitsAmount(allocatedTotal),
      difference: unitsAmount(difference),
    };
  }

  const feePoolsTotalUnits = FEE_POOL_KEYS.reduce((sum, pool) => sum + poolUnits[pool], ZERO);
  const classifiedBuckets = principalTotalUnits + feePoolsTotalUnits + refundTotalUnits;
  const otherfeeUnits = originalTotalUnits - classifiedBuckets; // 兜底差额
  const differenceUnits = otherfeeUnits - suppressedTotalUnits; // 应仅剩被抑制本金
  const summaryDataUnits = originalTotalUnits - (classifiedBuckets + otherfeeUnits); // 应为 0
  const totalInternalOk = differenceUnits === ZERO && summaryDataUnits === ZERO;
  let controlOk = true;
  if (options.controlTotal !== undefined) {
    controlOk = originalTotalUnits === parseSignedUnits(options.controlTotal);
  }
  const totalOk = totalInternalOk && controlOk;
  const ok = currencyOk && allocationOk && totalOk;
  if (!ok) {
    throw new Error(
      `结算分摊对账失败，整批拒绝：currencyOk=${currencyOk} allocationOk=${allocationOk} totalOk=${totalOk} (internal=${totalInternalOk} control=${controlOk})`,
    );
  }

  // ⑨ inputDigest = sha256(有序 rowHash + rowNumber)
  const inputDigest = sha256Hex(
    JSON.stringify(
      [...rows]
        .sort((a, b) => a.rowNumber - b.rowNumber)
        .map((row) => [row.rowNumber, row.rowHash]),
    ),
  );
  const idempotencyKey = sha256Hex(
    JSON.stringify([
      scope.organizationId,
      scope.workspaceId,
      settlementReportId,
      scope.settlementId,
      scope.currency,
      scope.marketplaceId,
      algorithmVersion,
      remainderPolicy,
      inputDigest,
    ]),
  );
  const requestHash = sha256Hex(
    JSON.stringify({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      settlementReportId,
      settlementId: scope.settlementId,
      currency: scope.currency,
      marketplaceId: scope.marketplaceId,
      algorithmVersion,
      remainderPolicy,
      principalThreshold: thresholdText,
      controlTotal: options.controlTotal ?? null,
      inputDigest,
    }),
  );

  const distinctOrderKeys = [
    ...new Set(keptPrincipal.map((entry) => distinctOrderKey(entry.row, scope))),
  ].sort();

  const header: AllocationHeader = {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    settlementReportId,
    settlementId: scope.settlementId,
    currency: scope.currency,
    marketplaceId: scope.marketplaceId,
    basisType,
    algorithmVersion,
    remainderPolicy,
    inputDigest,
    idempotencyKey,
    requestHash,
    status: "STAGED",
    lineCount: skuEntries.length,
    inputRowCount: rows.length,
  };

  const reconciliation: AllocationReconciliation = {
    ok,
    currency: { ok: currencyOk, currency: options.currency, distinct: distinctCurrencies },
    allocationVsPool: { ok: allocationOk, pools: allocationPools },
    total: {
      ok: totalOk,
      originalTotal: unitsAmount(originalTotalUnits),
      principalTotal: unitsAmount(principalTotalUnits),
      refundTotal: unitsAmount(refundTotalUnits),
      feePoolsTotal: unitsAmount(feePoolsTotalUnits),
      otherfee: unitsAmount(otherfeeUnits),
      suppressedTotal: unitsAmount(suppressedTotalUnits),
      summaryData: unitsAmount(summaryDataUnits),
      difference: unitsAmount(differenceUnits),
      controlTotal: options.controlTotal ?? null,
    },
    distinctOrderCount: distinctOrderKeys.length,
  };

  const dedupeEvidence: AllocationDedupeEvidence = {
    scope,
    classifiedCounts,
    overlapGroups,
    suppressedRowNumbers: suppressedPrincipal.map((entry) => entry.row.rowNumber).sort((a, b) => a - b),
    excludedRowNumbers: excluded.map((entry) => entry.row.rowNumber),
    distinctOrderKeys,
    distinctOrderCount: distinctOrderKeys.length,
  };

  // 对账全部通过后才产出 lines（任何失败已在上面抛错，整批不产出）
  const lines: AllocationLine[] = skuEntries.map(([sku, aggregate], index) => ({
    sku,
    sellerSku: aggregate.sellerSku,
    businessDate: aggregate.businessDate,
    currency: options.currency,
    basisAmount: unitsAmount(weights[index]),
    rate: rates[index],
    shareStorageFee: unitsAmount(sharesByLine.storageFee[index]),
    shareLongStorageFee: unitsAmount(sharesByLine.longStorageFee[index]),
    shareAdvSpendFee: unitsAmount(sharesByLine.advSpendFee[index]),
    shareCouponRedemptionFee: unitsAmount(sharesByLine.couponRedemptionFee[index]),
    shareReserveFee: unitsAmount(sharesByLine.reserveFee[index]),
    shareReimbursementFee: unitsAmount(sharesByLine.reimbursementFee[index]),
    shareDisposalFee: unitsAmount(sharesByLine.disposalFee[index]),
    shareShopOtherFee: unitsAmount(sharesByLine.shopOtherFee[index]),
    isRemainderBearer: bearerFlags[index],
    dedupeKey: buildDedupeKey(aggregate.representativeRow, scope),
    overlapKey: buildOverlapKey(aggregate.representativeRow, scope),
    classification: "SKU_PRINCIPAL",
    principalRowRefs: aggregate.principalRowRefs,
    feeRowRefs: feeRowRefsByPool,
    suppressedRowNumbers: aggregate.suppressedRowNumbers,
    dedupeEvidence: {
      overlapKeys: aggregate.overlapKeys,
      distinctOrderKeys: [...new Set(aggregate.distinctOrderKeys)].sort(),
    },
  }));

  return { header, lines, reconciliation, dedupeEvidence };
}
