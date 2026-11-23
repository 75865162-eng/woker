import { prisma } from "@/lib/db/prisma";
import { scoped } from "@/lib/wms/access";
import { assertFinanceAction } from "@/lib/finance/access";
import type { WmsScope } from "@/lib/wms/contracts";
import { FEE_POOL_KEYS, type FeePoolKey } from "./settlement-fee-classification";

/**
 * 结算 SKU 费用透视汇总（Wimoor 对标 §3 P6 / §4.1）。
 *
 * 口径（本项目原则 + 用户确认的保守默认）：
 * - 只汇总「已发布的有效结算分摊行」，原始行可回溯；
 * - 分组键 SKU + currency，原币不折算（汇率来源待业务确认，不臆造）；
 * - 8 类费用池透视成列（storage/longStorage/adv/coupon/reserve/reimbursement/disposal/other）；
 * - 金额用十进制字符串保真，避免浮点误差；缺失值保持 null，不补零；
 * - 派生「结算口径毛利」= 结算本金 − 8 类费用合计；明确标注这不是最终利润
 *   （未含采购成本 / 广告全量 / 税费 / 本地费用，见 P7）。
 */

export type PivotLineInput = {
  sku: string;
  currency: string;
  basisAmount: string;
  shareStorageFee?: string | null;
  shareLongStorageFee?: string | null;
  shareAdvSpendFee?: string | null;
  shareCouponRedemptionFee?: string | null;
  shareReserveFee?: string | null;
  shareReimbursementFee?: string | null;
  shareDisposalFee?: string | null;
  shareShopOtherFee?: string | null;
};

export type SkuPivotRow = {
  sku: string;
  currency: string;
  lineCount: number;
  basis: string; // 结算本金合计（原币）
  fees: Record<FeePoolKey, string>; // 8 类费用透视列（原币）
  feeTotal: string;
  settlementMargin: string; // 结算口径毛利 = 本金 − 费用合计
  marginRate: string | null; // 毛利率 = 结算口径毛利 / 本金；本金为 0 或缺失为 null
};

/** 安全十进制解析：只接受有限数字字符串，否则 0（仅用于汇总输入，源数据已校验）。 */
function dec(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 保留最多 6 位小数、去掉尾随 0 的字符串输出。 */
function fmt(n: number): string {
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

const SHARE_FIELD: Record<FeePoolKey, keyof PivotLineInput> = {
  storageFee: "shareStorageFee",
  longStorageFee: "shareLongStorageFee",
  advSpendFee: "shareAdvSpendFee",
  couponRedemptionFee: "shareCouponRedemptionFee",
  reserveFee: "shareReserveFee",
  reimbursementFee: "shareReimbursementFee",
  disposalFee: "shareDisposalFee",
  shopOtherFee: "shareShopOtherFee",
};

/** 纯函数：分摊行 → SKU×币种透视汇总。便于单测，无 IO。 */
export function buildSettlementSkuPivot(lines: PivotLineInput[]): SkuPivotRow[] {
  const groups = new Map<string, {
    sku: string; currency: string; lineCount: number; basis: number;
    fees: Record<FeePoolKey, number>;
  }>();
  for (const line of lines) {
    const sku = (line.sku ?? "").trim();
    const currency = (line.currency ?? "").trim();
    if (!sku || !currency) continue;
    const key = `${sku}\u0000${currency}`;
    let g = groups.get(key);
    if (!g) {
      g = { sku, currency, lineCount: 0, basis: 0, fees: Object.fromEntries(FEE_POOL_KEYS.map(k => [k, 0])) as Record<FeePoolKey, number> };
      groups.set(key, g);
    }
    g.lineCount += 1;
    g.basis += dec(line.basisAmount);
    for (const pool of FEE_POOL_KEYS) g.fees[pool] += dec(line[SHARE_FIELD[pool]]);
  }
  return [...groups.values()].map(g => {
    const feeTotal = FEE_POOL_KEYS.reduce((sum, k) => sum + g.fees[k], 0);
    const settlementMargin = g.basis - feeTotal;
    const marginRate = g.basis !== 0 ? settlementMargin / g.basis : null;
    return {
      sku: g.sku,
      currency: g.currency,
      lineCount: g.lineCount,
      basis: fmt(g.basis),
      fees: Object.fromEntries(FEE_POOL_KEYS.map(k => [k, fmt(g.fees[k])])) as Record<FeePoolKey, string>,
      feeTotal: fmt(feeTotal),
      settlementMargin: fmt(settlementMargin),
      marginRate: marginRate === null ? null : fmt(marginRate),
    };
  }).sort((a, b) => a.currency.localeCompare(b.currency) || a.sku.localeCompare(b.sku));
}

export const SETTLEMENT_PIVOT_BASIS =
  "结算 SKU 透视：按已发布结算分摊行，以 SKU+币种分组；8 类费用池透视成列；原币不折算（汇率来源待业务确认）。结算口径毛利=本金−8类费用，未含采购成本/广告全量/税费/本地费用，非最终利润。缺失不补零，金额字符串保真。";

const PIVOT_ROW_CAP = 10000;

/** 只读查询：已发布结算分摊行 → SKU×币种透视汇总。带财务 view 权限与 scope。 */
export async function readSettlementSkuPivot(scope: WmsScope, params: URLSearchParams): Promise<{
  rows: SkuPivotRow[]; basis: string; asOf: string; truncated: boolean;
}> {
  const allocationId = params.get("allocationId")?.trim() || "";
  const skuFilter = params.get("sku")?.trim().slice(0, 200) || "";
  const currency = params.get("currency")?.trim().slice(0, 20) || "";
  const asOf = new Date().toISOString();
  const result = await prisma.$transaction(async (tx) => {
    await assertFinanceAction(tx, scope, "view");
    const published = await tx.amazonSettlementAllocation.findMany({
      where: { ...scoped(scope), status: "PUBLISHED", ...(allocationId ? { id: allocationId } : {}) },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const ids = published.map(a => a.id);
    if (!ids.length) return { lines: [] as PivotLineInput[], truncated: false };
    const lines = await tx.amazonSettlementAllocationLine.findMany({
      where: {
        ...scoped(scope),
        allocationId: { in: ids },
        ...(skuFilter ? { sku: { contains: skuFilter } } : {}),
        ...(currency ? { currency } : {}),
      },
      select: {
        sku: true, currency: true, basisAmount: true,
        shareStorageFee: true, shareLongStorageFee: true, shareAdvSpendFee: true, shareCouponRedemptionFee: true,
        shareReserveFee: true, shareReimbursementFee: true, shareDisposalFee: true, shareShopOtherFee: true,
      },
      orderBy: [{ sku: "asc" }],
      take: PIVOT_ROW_CAP + 1,
    });
    return { lines: lines.slice(0, PIVOT_ROW_CAP) as PivotLineInput[], truncated: lines.length > PIVOT_ROW_CAP };
  });
  return {
    rows: buildSettlementSkuPivot(result.lines),
    basis: SETTLEMENT_PIVOT_BASIS,
    asOf,
    truncated: result.truncated,
  };
}
