import type { NormalizedDomainReportRow } from "./domain-reports";

/**
 * Amazon 结算到 SKU 分摊 —— 分类与去重键（纯函数，零 IO）。
 *
 * 上游语义来源：
 *  - AmzSettlementSKUShareServiceImpl#getShopFee (L65-108)：把结算行拆成
 *    「SKU 级本金」与「店铺级 8 类费用池」；SKU 级行只贡献本金基数，不进费用池。
 *  - t_amz_settlement_amount_type_nonsku.sql：68 行 (transaction_type,
 *    amount_type, amount_description) 的非 SKU 分类表（含 '*' 通配）。
 *  - 去重口径：COUNT(DISTINCT order_id)、Refund/ItemPrice/Principal 单列 refund
 *    不冲减 principal、Transfer of funds unsuccessful 行排除。
 *
 * 本模块**不** import prisma / @/lib/db / SP-API / data-access / 任何 process.env，
 * 只做字符串匹配与键拼接。金额解析、sha256、定点运算均在调用方完成。
 */

export type SettlementClassification =
  | "SKU_PRINCIPAL"
  | "SKU_REFUND"
  | "STORE_FEE"
  | "EXCLUDED";

/** 8 类店铺费用池（顺序与 schema 的 share* 字段一致）。 */
export const FEE_POOL_KEYS = [
  "storageFee",
  "longStorageFee",
  "advSpendFee",
  "couponRedemptionFee",
  "reserveFee",
  "reimbursementFee",
  "disposalFee",
  "shopOtherFee",
] as const;
export type FeePoolKey = (typeof FEE_POOL_KEYS)[number];

/**
 * 非 SKU 分类规则常量（精简自 68 行上游表；'*' 通配任意值）。
 * 命中即视为店铺级 STORE_FEE 行。SKU 级本金行（如 Order/ItemPrice/Principal）
 * 不在表内，默认落到 SKU_PRINCIPAL；退款与排除行由 classifySettlementRow 前置判定。
 */
export type NonSkuClassificationRule = {
  transactionType: string;
  amountType: string;
  amountDescription: string;
};
export const NON_SKU_CLASSIFICATION_RULES: readonly NonSkuClassificationRule[] = [
  { transactionType: "*", amountType: "*", amountDescription: "Storage Fee" },
  { transactionType: "*", amountType: "*", amountDescription: "FBA Long-Term Storage" },
  { transactionType: "*", amountType: "*", amountDescription: "StorageRenewalBilling" },
  { transactionType: "*", amountType: "Cost of Advertising", amountDescription: "*" },
  { transactionType: "CouponRedemptionFee", amountType: "CouponRedemptionFee", amountDescription: "*" },
  { transactionType: "*", amountType: "FBA Inventory Reimbursement", amountDescription: "*" },
  { transactionType: "*", amountType: "Manual Processing Fee Reimbursement", amountDescription: "*" },
  { transactionType: "*", amountType: "Item Fee Adjustment", amountDescription: "*" },
  { transactionType: "*", amountType: "*", amountDescription: "Previous Reserve Amount Balance" },
  { transactionType: "*", amountType: "*", amountDescription: "Current Reserve Amount" },
  { transactionType: "*", amountType: "*", amountDescription: "DisposalComplete" },
  { transactionType: "*", amountType: "*", amountDescription: "RemovalComplete" },
  // 其余 other-transaction 行兜底进 otherfee（shopOtherFee）池
  { transactionType: "other-transaction", amountType: "other-transaction", amountDescription: "*" },
];

/** 去重/归属键的作用域：一次分摊的组织、工作区、结算、币种与站点身份。 */
export type SettlementAllocationScope = {
  organizationId: string;
  workspaceId: string;
  settlementId: string;
  currency: string;
  marketplaceId: string;
};

function wildcardMatch(pattern: string, value: string): boolean {
  return pattern === "*" || pattern === value;
}

/** 8 类池业务语义，复刻上游 getShopFee L78-101 的 if/else 优先级。 */
export function settlementFeePool(row: NormalizedDomainReportRow): FeePoolKey {
  const type = row.amountType ?? "";
  const desc = row.amountDescription ?? "";
  if (desc === "Storage Fee") return "storageFee";
  if (desc === "FBA Long-Term Storage" || desc === "StorageRenewalBilling") return "longStorageFee";
  if (desc === "Previous Reserve Amount Balance" || desc === "Current Reserve Amount") return "reserveFee";
  if (type === "Cost of Advertising") return "advSpendFee";
  if (type === "CouponRedemptionFee") return "couponRedemptionFee";
  if (
    type === "FBA Inventory Reimbursement" ||
    type === "Manual Processing Fee Reimbursement" ||
    type === "Item Fee Adjustment"
  ) return "reimbursementFee";
  if (desc === "DisposalComplete" || desc === "RemovalComplete") return "disposalFee";
  return "shopOtherFee";
}

/**
 * classifySettlementRow：四分类。
 *  - EXCLUDED：Transfer of funds unsuccessful（上游去重口径整行排除）。
 *  - SKU_REFUND：Refund/ItemPrice/Principal 单列 refund，不冲减 principal。
 *  - STORE_FEE：命中非 SKU 分类表；其所属费用池由 settlementFeePool 给出。
 *  - SKU_PRINCIPAL：其余 SKU 级本金行（只贡献本金基数，不进费用池）。
 */
export function classifySettlementRow(row: NormalizedDomainReportRow): SettlementClassification {
  const transactionType = row.transactionType ?? "";
  const amountType = row.amountType ?? "";
  const amountDescription = row.amountDescription ?? "";

  if (amountDescription.startsWith("Transfer of funds unsuccessful")) return "EXCLUDED";
  if (transactionType === "Refund" && amountType === "ItemPrice" && amountDescription === "Principal") {
    return "SKU_REFUND";
  }
  if (
    NON_SKU_CLASSIFICATION_RULES.some(
      (rule) =>
        wildcardMatch(rule.transactionType, transactionType) &&
        wildcardMatch(rule.amountType, amountType) &&
        wildcardMatch(rule.amountDescription, amountDescription),
    )
  ) return "STORE_FEE";
  return "SKU_PRINCIPAL";
}

/** 门店级费用行所属费用池；非 STORE_FEE 返回 null。 */
export function classifySettlementFeePool(row: NormalizedDomainReportRow): FeePoolKey | null {
  return classifySettlementRow(row) === "STORE_FEE" ? settlementFeePool(row) : null;
}

function keySegments(row: NormalizedDomainReportRow, scope: SettlementAllocationScope): (string | null)[] {
  return [
    scope.organizationId,
    scope.workspaceId,
    scope.settlementId,
    scope.currency,
    scope.marketplaceId,
    row.sellerSku,
    row.orderId,
    row.transactionType,
    row.amountType,
    row.amountDescription,
    row.businessDate,
    String(row.rowNumber),
  ];
}

function starify(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "*" : String(value);
}

/**
 * dedupeKey 格式（12 段，空值用 '*'）：
 * org|ws|settlementId|currency|marketplaceId|sellerSku|orderId|transactionType|
 * amountType|amountDescription|businessDate|rowNumber
 * 其中 transactionType 是区分 Order / Refund 的关键维度。
 */
export function buildDedupeKey(row: NormalizedDomainReportRow, scope: SettlementAllocationScope): string {
  return keySegments(row, scope).map(starify).join("|");
}

/** overlapKey = dedupeKey 去掉末段 rowNumber（业务重叠口径）。 */
export function buildOverlapKey(row: NormalizedDomainReportRow, scope: SettlementAllocationScope): string {
  return keySegments(row, scope).slice(0, -1).map(starify).join("|");
}

/** distinctOrderKey：COUNT(DISTINCT order_id) 口径，仅依赖订单身份（同一订单只计一次）。 */
export function distinctOrderKey(row: NormalizedDomainReportRow, scope: SettlementAllocationScope): string {
  return [
    scope.organizationId,
    scope.workspaceId,
    scope.settlementId,
    scope.marketplaceId,
    scope.currency,
    row.orderId,
  ]
    .map(starify)
    .join("|");
}
