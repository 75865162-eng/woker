/**
 * 报告1 阶段0 P1：为销售预聚合提供「基准币种金额」投影的汇率来源。
 *
 * 架构红线（沿用 display-fx.ts / fx-rates API）：
 * - 绝不臆造汇率：只接纳 FinanceExchangeRate 中 status=ACTIVE、reviewedBy 非空、
 *   reference 非空的已复核汇率；草稿/未复核/无来源一律不进入投影。
 * - 基准币种来自启用账套（FinanceBook.currency），不是硬编码；无账套则不投影。
 * - 每个 source→base 币种对只取观测时间最新的一条（observedAt desc）。
 * - 默认关闭：SELLFOX_AGG_FX_ENABLED !== "true" 时返回 undefined，物化层写 NULL。
 *   这样未配置好财务账套/汇率的环境不会出现臆造或半成品 amountBase。
 *
 * 本模块只读财务主数据，不写任何表，也不改变展示层换算语义。
 */
import type { SalesFxProjection, ReviewedFxRateInput } from "./agg-refresh";

export function salesFxProjectionEnabled(): boolean {
  return process.env.SELLFOX_AGG_FX_ENABLED === "true";
}

type RateRow = {
  sourceCurrency: string;
  targetCurrency: string;
  rate: { toString(): string } | number | string;
  reference: string;
  observedAt: Date | string;
};

/**
 * 纯函数：从已按 observedAt desc 排序的汇率行中，挑选 source→base 的最新一条。
 * 过滤严格遵守已复核口径；返回 null 表示无可用投影（→ 物化层写 NULL）。
 */
export function pickReviewedRates(rows: RateRow[], baseCurrency: string): SalesFxProjection | null {
  const base = (baseCurrency || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) return null;
  const best = new Map<string, ReviewedFxRateInput>();
  for (const row of rows) {
    const source = String(row.sourceCurrency ?? "").toUpperCase();
    const target = String(row.targetCurrency ?? "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(source) || source === base || target !== base) continue;
    if (typeof row.reference !== "string" || !row.reference.trim()) continue;
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (!best.has(source)) {
      best.set(source, { sourceCurrency: source, targetCurrency: base, rate, reference: row.reference });
    }
  }
  if (!best.size) return null;
  return { baseCurrency: base, rates: [...best.values()] };
}

// 用宽松的调用签名以兼容 Prisma 生成的强泛型客户端（其方法参数为受限的字面量类型）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseFind = (args?: any) => Promise<any>;
type PrismaLike = {
  financeBook: { findFirst: LooseFind };
  financeExchangeRate: { findMany: LooseFind };
};

/**
 * 从财务主数据构造销售投影。默认关闭；开启后若账套/汇率未就绪返回 undefined（fail-safe：写 NULL）。
 * 任何异常都吞掉并返回 undefined，绝不让财务主数据问题影响销售同步。
 */
export async function loadSalesFxProjection(
  scope: { organizationId: string; workspaceId: string },
  prisma: PrismaLike,
): Promise<SalesFxProjection | undefined> {
  if (!salesFxProjectionEnabled()) return undefined;
  try {
    const book = await prisma.financeBook.findFirst({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, enabled: true },
      orderBy: { code: "asc" },
      select: { currency: true },
    });
    if (!book?.currency) return undefined;
    const rates = await prisma.financeExchangeRate.findMany({
      where: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        status: "ACTIVE",
        reviewedBy: { not: null },
        targetCurrency: book.currency.toUpperCase(),
      },
      select: { sourceCurrency: true, targetCurrency: true, rate: true, reference: true, observedAt: true },
      orderBy: { observedAt: "desc" },
      take: 500,
    });
    return pickReviewedRates(rates, book.currency) ?? undefined;
  } catch {
    return undefined;
  }
}
