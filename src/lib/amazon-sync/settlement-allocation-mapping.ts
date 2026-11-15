/**
 * Amazon 结算行：数据库持久化形状 → 分摊算法归一化形状。
 *
 * 纯函数，零 IO：不 import prisma / .env / SP-API。
 * 存在的理由：processor.ts 在写入 AmazonSettlementRow 时**刻意剥离了
 * quantityOriginal**（见 `const { quantityOriginal: _quantity, fields, ... } = row`），
 * 但把原始 TSV 列保留在 fields JSON 里；分摊算法的 SALES 兜底基数需要数量，
 * 因此这里按 domain-reports.ts L369 的同款优先级从 fields 恢复，避免两套口径。
 */
import type { NormalizedDomainReportRow } from "./domain-reports";

/** 服务层从 AmazonSettlementRow 读取的最小列集合（便于隔离测试构造，无需 Prisma）。 */
export type StoredSettlementRow = {
  rowNumber: number;
  rowHash: string;
  businessDateRaw: string | null;
  businessDate: string | null;
  orderId: string | null;
  sellerSku: string | null;
  asin: string | null;
  amountOriginal: string | null;
  currencyCode: string | null;
  currencySource: string | null;
  currencySourceRowNumber: number | null;
  transactionType: string | null;
  amountType: string | null;
  amountDescription: string | null;
  marketplaceId: string | null;
  fields: unknown;
};

/** 与 domain-reports.ts L369 对 settlements 的取值顺序保持一致。 */
const QUANTITY_KEYS = [
  "quantity-shipped",
  "quantity",
  "quantity-purchased",
  "quantity-reimbursed-total",
] as const;

/** jsonb → Record<string,string>；丢弃 null / 嵌套对象 / 数组，绝不猜测数值语义。 */
export function settlementStringFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") result[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = String(raw);
    else if (typeof raw === "boolean") result[key] = String(raw);
  }
  return result;
}

function firstNonBlank(fields: Record<string, string>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

export function settlementQuantity(fields: Record<string, string>): string | null {
  return firstNonBlank(fields, QUANTITY_KEYS);
}

export function rowSettlementId(fields: Record<string, string>): string | null {
  return firstNonBlank(fields, ["settlement-id"]);
}

export function rowMarketplaceId(fields: Record<string, string>): string | null {
  return firstNonBlank(fields, ["marketplace-id"]);
}

/** DB 行 → 分摊算法输入。不改金额、不补币种、不丢行（对账完整性依赖全量输入）。 */
export function toNormalizedSettlementRows(
  rows: readonly StoredSettlementRow[],
): NormalizedDomainReportRow[] {
  return rows.map((row) => {
    const fields = settlementStringFields(row.fields);
    return {
      rowNumber: row.rowNumber,
      rowHash: row.rowHash,
      businessDateRaw: row.businessDateRaw,
      businessDate: row.businessDate,
      orderId: row.orderId,
      sellerSku: row.sellerSku,
      asin: row.asin,
      transactionType: row.transactionType,
      amountType: row.amountType,
      amountDescription: row.amountDescription,
      amountOriginal: row.amountOriginal,
      currencyCode: row.currencyCode,
      currencySource: row.currencySource,
      currencySourceRowNumber: row.currencySourceRowNumber,
      quantityOriginal: settlementQuantity(fields),
      fields,
    };
  });
}

export type BatchIdentity = {
  settlementId: string;
  currency: string;
  marketplaceId: string;
};

/**
 * 批次身份校验：一个分摊批次只能属于同一结算号、同一站点、同一币种。
 * 上游 AmzSettlementSKUShareServiceImpl 以 settlement_id 为分组键；
 * 混批会让 COUNT(DISTINCT order_id) 与本金占比口径失真，故整批拒绝而非静默过滤。
 */
export function assertBatchIdentity(
  rows: readonly StoredSettlementRow[],
  expected: BatchIdentity,
): void {
  if (!rows.length) throw new Error("已发布结算报告没有可分摊的已归属行。");
  const fields = rows.map((row) => settlementStringFields(row.fields));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const current = fields[index];
    const rowNumber = row.rowNumber;

    const settlementId = rowSettlementId(current);
    if (!settlementId || settlementId !== expected.settlementId) {
      throw new Error(`第 ${rowNumber} 行的 settlement-id 缺失或不属于结算 ${expected.settlementId}。`);
    }
    const marketplaceId = row.marketplaceId || rowMarketplaceId(current);
    if (!marketplaceId || marketplaceId !== expected.marketplaceId) {
      throw new Error(`第 ${rowNumber} 行的站点归属缺失或不属于 ${expected.marketplaceId}。`);
    }
    if (!row.currencyCode || row.currencyCode !== expected.currency) {
      throw new Error(`第 ${rowNumber} 行的币种缺失或不属于 ${expected.currency}。`);
    }
    if (!row.rowHash) throw new Error(`第 ${rowNumber} 行缺少 rowHash，无法生成输入摘要。`);
    if (!row.amountOriginal) throw new Error(`第 ${rowNumber} 行缺少金额，整批拒绝。`);
  }
}
