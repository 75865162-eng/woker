/**
 * 广告归因覆盖率（报告1 P2 / 报告2 P2-1）——广告花费归因结构化与覆盖率告警。
 *
 * 目标：把广告行的销售额拆成 sameSku / otherSku（同 SKU / 跨 SKU），
 * 计算「归因覆盖率」——已能匹配到销售归因的花费占广告总花费的比例。
 * 对标赛狐"广告真实净利润"要求覆盖率 ≥99.5%；本项目对**未覆盖行显式告警**，
 * 绝不把 null 归因静默当作 0（沿用 wimoor-derived-metrics.ts 红线）。
 *
 * 口径：
 * - 每行广告花费 spend，若 sameSkuSales/otherSkuSales/conversions 至少一个有非 null 归因值 → 已覆盖；
 * - 全 null → 未覆盖，计入 uncoveredSpend，显式列出。
 * - coverage = coveredSpend / totalSpend（BigInt 6 位，比率按万分之一精度输出）。
 * - 分窗口（1d/7d/14d/30d）独立计算，不混窗口。
 */

import { amountUnits, unitsAmount } from "@/lib/finance/open-item-rules";

export class AdsAttributionError extends Error {}
function fail(message: string): never { throw new AdsAttributionError(message); }
const ZERO = BigInt(0);
const BP = BigInt(10000); // 万分比基数

export type AttributionWindow = "1d" | "7d" | "14d" | "30d";
export const ATTRIBUTION_WINDOWS: readonly AttributionWindow[] = ["1d", "7d", "14d", "30d"];

/** 单行广告归因（值为 6 位定点字符串；null = 该窗口无归因数据）。 */
export type AdsAttributionRow = {
  rowKey: string;
  spend: string;
  /** 指定窗口的同 SKU 销售额；null = 未覆盖。 */
  salesSameSku: string | null;
  /** 指定窗口的跨 SKU 销售额；null = 未覆盖。 */
  salesOtherSku: string | null;
  conversionsSameSku: string | null;
  conversionsOtherSku: string | null;
};

export type AttributionCoverageResult = {
  window: AttributionWindow;
  totalSpend: string;
  coveredSpend: string;
  uncoveredSpend: string;
  /** 覆盖率（万分比整数，如 9960 = 99.60%）；totalSpend=0 时为 null（不臆造）。 */
  coverageBp: number | null;
  /** 覆盖率是否达标（默认 ≥99.5%，即 9950bp）；totalSpend=0 时为 null。 */
  meetsTarget: boolean | null;
  /** 未覆盖行键（显式告警，不静默丢弃）。 */
  uncoveredRows: string[];
  coveredRowCount: number;
  uncoveredRowCount: number;
  totalRowCount: number;
};

function parseAmount(value: string, label: string): bigint {
  try { return amountUnits(value); }
  catch { fail(`${label} 金额非法：${value}`); }
}

function isCovered(row: AdsAttributionRow): boolean {
  return [row.salesSameSku, row.salesOtherSku, row.conversionsSameSku, row.conversionsOtherSku]
    .some(v => v !== null && v !== undefined && String(v).trim() !== "");
}

/**
 * 计算指定窗口的广告归因覆盖率。
 * - 未覆盖行的花费计入 uncoveredSpend 并列出 rowKey（告警而非静默）；
 * - targetBp 默认 9950（99.50%），可按报告要求调整；
 * - totalSpend=0 时 coverageBp/meetsTarget 为 null（不臆造 100%）。
 */
export function computeAttributionCoverage(
  rows: readonly AdsAttributionRow[],
  window: AttributionWindow = "7d",
  targetBp = 9950,
): AttributionCoverageResult {
  if (!ATTRIBUTION_WINDOWS.includes(window)) fail(`未知归因窗口：${window}`);
  if (!Number.isInteger(targetBp) || targetBp < 0 || targetBp > 10000) fail("覆盖率目标须为 0-10000 的万分比整数。");
  let total = ZERO, covered = ZERO, uncovered = ZERO;
  const uncoveredRows: string[] = [];
  let coveredCount = 0, uncoveredCount = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    if (typeof row.rowKey !== "string" || !row.rowKey) fail("广告行 rowKey 不能为空。");
    if (seen.has(row.rowKey)) fail(`广告行 rowKey 重复：${row.rowKey}`);
    seen.add(row.rowKey);
    const spend = parseAmount(row.spend, "spend");
    if (spend < ZERO) fail("广告花费不能为负。");
    total += spend;
    if (isCovered(row)) { covered += spend; coveredCount++; }
    else { uncovered += spend; uncoveredCount++; uncoveredRows.push(row.rowKey); }
  }

  const coverageBp = total === ZERO ? null : Number((covered * BP) / total);
  return {
    window,
    totalSpend: unitsAmount(total),
    coveredSpend: unitsAmount(covered),
    uncoveredSpend: unitsAmount(uncovered),
    coverageBp,
    meetsTarget: coverageBp === null ? null : coverageBp >= targetBp,
    uncoveredRows,
    coveredRowCount: coveredCount,
    uncoveredRowCount: uncoveredCount,
    totalRowCount: rows.length,
  };
}

/**
 * 同/跨 SKU 销售额拆分汇总（供广告真实净利润使用）。
 * 缺值不补零：未覆盖行的 sales 不计入，但返回 uncoveredSpend 供上层标注。
 */
export function splitAttributedSales(rows: readonly AdsAttributionRow[]) {
  let sameSku = ZERO, otherSku = ZERO;
  for (const row of rows) {
    if (row.salesSameSku !== null && String(row.salesSameSku).trim() !== "") sameSku += parseAmount(row.salesSameSku, "salesSameSku");
    if (row.salesOtherSku !== null && String(row.salesOtherSku).trim() !== "") otherSku += parseAmount(row.salesOtherSku, "salesOtherSku");
  }
  return { salesSameSku: unitsAmount(sameSku), salesOtherSku: unitsAmount(otherSku) };
}
