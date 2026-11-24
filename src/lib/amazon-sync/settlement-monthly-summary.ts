import { prisma } from "@/lib/db/prisma";
import type { SyncScope } from "./policy";
import { amazonAccountReadAccess } from "./read-account";

/**
 * 结算月度汇总（Wimoor 结算记录 / summaryMonth 对标，迁移到亚马逊模块）。
 *
 * 口径（保守、不造数）：
 * - 数据源仅 AmazonSettlementRow 真实结算行（SP-API 结算报告），不接赛狐、不含 ERP 财务。
 * - 只统计 ATTRIBUTED 行；MISSING_MARKETPLACE 隔离行不计入、单列提示。
 * - 按币种分列，原币不折算；金额 amountOriginal 字符串保真。
 * - 交易类型透视：按 transactionType × 币种汇总笔数与金额。
 * - 月度趋势：按 businessDate(YYYY-MM-DD) 的年月 × 币种 × 交易类型汇总笔数与金额。
 * - 订单数按 distinct orderId（同订单多行不重复计）；缺业务日不补零。
 */

export type SettlementLineInput = {
  transactionType: string;
  currency: string;
  amount: string | null;
  businessDate: string | null; // YYYY-MM-DD
  orderId: string | null;
};

export type SettlementTypeRow = {
  transactionType: string;
  currency: string;
  lineCount: number;
  distinctOrders: number;
  amount: string;
};

export type SettlementMonthRow = {
  month: string; // YYYY-MM
  currency: string;
  transactionType: string;
  lineCount: number;
  amount: string;
};

/**
 * 安全十进制解析：兼容 Amazon 结算报告里逗号作小数分隔符的 locale 格式
 * （如 BRL/欧洲站 "115,31" = 115.31、"-17,61" = -17.61）。
 * 规则：含逗号且不含点 → 逗号视为小数点；同时含点和逗号 → 点为千分位、逗号为小数点；
 * 纯数字（含负号/单点）按原样解析。无法解析返回 0（不臆造）。
 */
function dec(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  let normalized = value.trim();
  if (normalized.includes(",")) {
    if (normalized.includes(".")) normalized = normalized.replace(/\./g, ""); // 点=千分位
    normalized = normalized.replace(",", "."); // 逗号=小数点
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** 纯函数：结算行 → 交易类型透视（按 transactionType × currency）。 */
export function buildSettlementTypeRows(lines: SettlementLineInput[]): SettlementTypeRow[] {
  const groups = new Map<string, { transactionType: string; currency: string; lineCount: number; amount: number; orders: Set<string> }>();
  for (const line of lines) {
    const type = (line.transactionType ?? "").trim();
    const currency = (line.currency ?? "").trim();
    if (!type || !currency) continue;
    const key = `${type}\u0000${currency}`;
    let g = groups.get(key);
    if (!g) {
      g = { transactionType: type, currency, lineCount: 0, amount: 0, orders: new Set() };
      groups.set(key, g);
    }
    g.lineCount += 1;
    g.amount += dec(line.amount);
    if (line.orderId) g.orders.add(line.orderId);
  }
  return [...groups.values()]
    .map(g => ({
      transactionType: g.transactionType,
      currency: g.currency,
      lineCount: g.lineCount,
      distinctOrders: g.orders.size,
      amount: fmt(g.amount),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.lineCount - a.lineCount || a.transactionType.localeCompare(b.transactionType));
}

/** 纯函数：结算行 → 月度趋势（按业务年月 × 币种 × 交易类型）。 */
export function buildSettlementMonthRows(lines: SettlementLineInput[]): SettlementMonthRow[] {
  const groups = new Map<string, { month: string; currency: string; transactionType: string; lineCount: number; amount: number }>();
  for (const line of lines) {
    const date = (line.businessDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const month = date.slice(0, 7);
    const type = (line.transactionType ?? "").trim();
    const currency = (line.currency ?? "").trim();
    if (!type || !currency) continue;
    const key = `${month}\u0000${currency}\u0000${type}`;
    let g = groups.get(key);
    if (!g) {
      g = { month, currency, transactionType: type, lineCount: 0, amount: 0 };
      groups.set(key, g);
    }
    g.lineCount += 1;
    g.amount += dec(line.amount);
  }
  return [...groups.values()]
    .map(g => ({ month: g.month, currency: g.currency, transactionType: g.transactionType, lineCount: g.lineCount, amount: fmt(g.amount) }))
    .sort((a, b) => b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency) || b.lineCount - a.lineCount);
}

export const SETTLEMENT_MONTHLY_BASIS = [
  "结算月度汇总口径（保守默认，迁移自 Wimoor 结算记录/月度汇总）：",
  "1) 数据源仅 AmazonSettlementRow（SP-API 结算报告真实行），不接赛狐、不含 ERP 财务。",
  "2) 只统计 ATTRIBUTED 行；MISSING_MARKETPLACE 等隔离行不计入，单列隔离计数。",
  "3) 按币种分列，原币不折算；金额字符串保真。",
  "4) 交易类型透视=按 transactionType×币种汇总笔数/金额；月度趋势=按业务日年月×币种×类型汇总；订单数按 distinct orderId。",
  "5) 缺业务日/缺金额不补零、不估算；报告发现窗口不等于结算周期。",
].join("\n");

const ROW_CAP = 60000;

/** 只读：已归属结算行 → 交易类型透视 + 月度趋势。 */
export async function readSettlementMonthlySummary(scope: SyncScope, params: URLSearchParams, actor?: string): Promise<{
  typeRows: SettlementTypeRow[]; monthRows: SettlementMonthRow[]; basis: string; asOf: string;
  totalLines: number; quarantinedCount: number; truncated: boolean;
}> {
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "settlements");
  const sellerIds = access.allSellers ? [] : access.sellerIds;
  const monthFilter = params.get("month")?.trim().slice(0, 7) ?? "";
  const currency = params.get("currency")?.trim().slice(0, 20) ?? "";

  const rows = await prisma.amazonSettlementRow.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      attributionStatus: "ATTRIBUTED",
      ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
      ...(monthFilter ? { businessDate: { startsWith: monthFilter } } : {}),
      ...(currency ? { currencyCode: currency } : {}),
    },
    select: { transactionType: true, currencyCode: true, amountOriginal: true, businessDate: true, orderId: true },
    orderBy: { businessDate: "desc" },
    take: ROW_CAP + 1,
  });

  const quarantinedCount = await prisma.amazonSettlementRow.count({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      attributionStatus: { not: "ATTRIBUTED" },
      ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
    },
  });

  const lines: SettlementLineInput[] = rows.slice(0, ROW_CAP).map(r => ({
    transactionType: r.transactionType ?? "",
    currency: r.currencyCode ?? "",
    amount: r.amountOriginal,
    businessDate: r.businessDate,
    orderId: r.orderId,
  }));

  return {
    typeRows: buildSettlementTypeRows(lines),
    monthRows: buildSettlementMonthRows(lines),
    basis: SETTLEMENT_MONTHLY_BASIS,
    asOf: new Date().toISOString(),
    totalLines: lines.length,
    quarantinedCount,
    truncated: rows.length > ROW_CAP,
  };
}
