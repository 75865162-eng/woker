import { prisma } from "@/lib/db/prisma";
import type { SyncScope } from "./policy";
import { amazonAccountReadAccess } from "./read-account";

/**
 * 财务交易费用透视（Wimoor 交易报告「费用统计 + 月度经营报告」对标，迁移到亚马逊模块）。
 *
 * 口径（保守、不造数，与本项目既定的财务边界一致）：
 * - 数据源仅为 AmazonFinanceRecord（SP-API Finances 2024-06-19 真实采集行），不接赛狐、不含 ERP 财务。
 * - 只统计已归属（attributionStatus=ATTRIBUTED）的行；MISSING_MARKETPLACE 等隔离行不计入、单列提示。
 * - 按币种分列，原币不折算（convertedAmount/convertedCurrency 不参与合计，汇率来源待业务确认）。
 * - 金额用十进制字符串保真；缺失保持 null，不补零、不估算。
 * - 费用统计：按 transactionType × currency 汇总笔数与金额（负数即扣费，保留原符号）。
 * - 月度经营：按业务月（postedAt 的 UTC 年月）× currency 汇总收入(ORDER_RELATED)/非订单费用(NON_ORDER)/净额与笔数。
 * - 已提交窗口不代表最终结算；延迟入账和递延交易仍需复核。
 */

export type FinanceLineInput = {
  transactionType: string;
  classification: string;
  currency: string;
  amount: string | null;
  postedAt: string; // ISO
};

export type FeeTypeRow = {
  transactionType: string;
  currency: string;
  count: number;
  amount: string;
};

export type FinanceMonthRow = {
  month: string; // YYYY-MM (UTC)
  currency: string;
  orderCount: number;
  orderAmount: string;
  nonOrderCount: number;
  nonOrderAmount: string;
  netAmount: string;
};

function dec(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** 纯函数：财务交易行 → 费用类型透视（按 transactionType × currency）。 */
export function buildFeeTypeRows(lines: FinanceLineInput[]): FeeTypeRow[] {
  const groups = new Map<string, { transactionType: string; currency: string; count: number; amount: number }>();
  for (const line of lines) {
    const type = (line.transactionType ?? "").trim();
    const currency = (line.currency ?? "").trim();
    if (!type || !currency) continue;
    const key = `${type}\u0000${currency}`;
    let g = groups.get(key);
    if (!g) {
      g = { transactionType: type, currency, count: 0, amount: 0 };
      groups.set(key, g);
    }
    g.count += 1;
    g.amount += dec(line.amount);
  }
  return [...groups.values()]
    .map(g => ({ transactionType: g.transactionType, currency: g.currency, count: g.count, amount: fmt(g.amount) }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.count - a.count || a.transactionType.localeCompare(b.transactionType));
}

/** 纯函数：财务交易行 → 月度经营透视（按 UTC 年月 × currency）。 */
export function buildFinanceMonthRows(lines: FinanceLineInput[]): FinanceMonthRow[] {
  const groups = new Map<string, {
    month: string; currency: string;
    orderCount: number; orderAmount: number;
    nonOrderCount: number; nonOrderAmount: number;
  }>();
  for (const line of lines) {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(line.postedAt)) continue;
    const month = line.postedAt.slice(0, 7);
    const currency = (line.currency ?? "").trim();
    if (!currency) continue;
    const key = `${month}\u0000${currency}`;
    let g = groups.get(key);
    if (!g) {
      g = { month, currency, orderCount: 0, orderAmount: 0, nonOrderCount: 0, nonOrderAmount: 0 };
      groups.set(key, g);
    }
    if (line.classification === "ORDER_RELATED") {
      g.orderCount += 1;
      g.orderAmount += dec(line.amount);
    } else if (line.classification === "NON_ORDER") {
      g.nonOrderCount += 1;
      g.nonOrderAmount += dec(line.amount);
    }
  }
  return [...groups.values()]
    .map(g => ({
      month: g.month,
      currency: g.currency,
      orderCount: g.orderCount,
      orderAmount: fmt(g.orderAmount),
      nonOrderCount: g.nonOrderCount,
      nonOrderAmount: fmt(g.nonOrderAmount),
      netAmount: fmt(g.orderAmount + g.nonOrderAmount),
    }))
    .sort((a, b) => b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency));
}

export const FINANCE_ANALYTICS_BASIS = [
  "财务交易费用透视口径（保守默认，迁移自 Wimoor 交易报告的费用统计/月度经营）：",
  "1) 数据源仅 AmazonFinanceRecord（SP-API Finances 真实采集），不接赛狐、不含 ERP 财务台账。",
  "2) 只统计已归属 ATTRIBUTED 行；MISSING_MARKETPLACE 等隔离行不计入，单列隔离计数。",
  "3) 按币种分列，原币不折算；金额字符串保真，负数即扣费保留原符号，缺失不补零。",
  "4) 费用统计=按 transactionType×币种汇总笔数/金额；月度经营=按 UTC 年月×币种分收入(ORDER_RELATED)与非订单费用(NON_ORDER)及净额。",
  "5) 已提交窗口不代表最终结算，延迟入账与递延交易需复核；convertedAmount 不参与合计（汇率来源待确认）。",
].join("\n");

const LINE_CAP = 60000;

/** 只读：已归属财务交易行 → 费用透视 + 月度经营。带账号可见范围校验。 */
export async function readFinanceTransactionAnalytics(scope: SyncScope, params: URLSearchParams, actor?: string): Promise<{
  feeRows: FeeTypeRow[]; monthRows: FinanceMonthRow[]; basis: string; asOf: string;
  totalLines: number; quarantinedCount: number; truncated: boolean;
}> {
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "finance");
  const sellerIds = access.allSellers ? [] : access.sellerIds;
  const fromRaw = params.get("from")?.trim().slice(0, 10) ?? "";
  const toRaw = params.get("to")?.trim().slice(0, 10) ?? "";
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? new Date(`${fromRaw}T00:00:00Z`) : null;
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? new Date(`${toRaw}T23:59:59.999Z`) : null;

  const rows = await prisma.amazonFinanceRecord.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      attributionStatus: "ATTRIBUTED",
      ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
      ...(fromDate || toDate ? { postedAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
    },
    select: { transactionType: true, classification: true, currency: true, amount: true, originalAmount: true, postedAt: true },
    orderBy: { postedAt: "desc" },
    take: LINE_CAP + 1,
  });

  const quarantinedCount = await prisma.amazonFinanceRecord.count({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      attributionStatus: { not: "ATTRIBUTED" },
      ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
    },
  });

  const lines: FinanceLineInput[] = rows.slice(0, LINE_CAP).map(r => ({
    transactionType: r.transactionType ?? "",
    classification: r.classification ?? "",
    currency: r.currency ?? "",
    // 优先原币字符串 originalAmount，回退 numeric amount（转字符串保真）
    amount: r.originalAmount ?? (r.amount === null ? null : String(r.amount)),
    postedAt: r.postedAt.toISOString(),
  }));

  return {
    feeRows: buildFeeTypeRows(lines),
    monthRows: buildFinanceMonthRows(lines),
    basis: FINANCE_ANALYTICS_BASIS,
    asOf: new Date().toISOString(),
    totalLines: lines.length,
    quarantinedCount,
    truncated: rows.length > LINE_CAP,
  };
}
