/**
 * 订单级财务事件 + 业务链路主键（报告2 P0-4 / P0-5）——纯键构造与分类，零 IO。
 *
 * 目标：让任一财务/退货/结算行都能反查到订单行与原始报告行，构成
 *   「订单 → 订单行 → 财务事件/退货/结算」的主键贯通（对标 WIMOOR t_orders_financial / BusinessLink）。
 *
 * 设计：
 * - ftype：把 SP-API Financial Event 分类为标准财务事件类型，未识别显式 UNKNOWN（不臆造）。
 * - 经济键 economicKey：订单身份 + 订单行 + 事件类型 + 币种 + 发布日，幂等去重（同键只入一次）。
 * - 链路键 orderLinkKey / reportRowKey：从财务/退货/结算侧反查订单与原始报告行。
 * - 全部为确定性字符串拼接，缺字段用 '*' 占位并显式标注，不静默补 0。
 */

export class OrderFinanceEventError extends Error {}

function fail(message: string): never { throw new OrderFinanceEventError(message); }
function seg(value: string | null | undefined): string {
  return value === null || value === undefined || String(value).trim() === "" ? "*" : String(value);
}
function need(value: string | null | undefined, label: string): string {
  if (value === null || value === undefined || String(value).trim() === "") fail(`${label} 不能为空。`);
  return String(value);
}

/** 标准财务事件类型（对齐 SP-API Financial Events 与 WIMOOR ftype）。 */
export const FINANCE_EVENT_TYPES = [
  "ORDER_CHARGE", "REFUND", "FBA_FEE", "COMMISSION", "ADVERTISING", "SETTLEMENT",
  "REIMBURSEMENT", "STORAGE_FEE", "OTHER_FEE", "UNKNOWN",
] as const;
export type FinanceEventType = (typeof FINANCE_EVENT_TYPES)[number];

/** 常见 SP-API event type 字符串 → 标准类型。未命中返回 UNKNOWN（显式，不猜测）。 */
const EVENT_TYPE_ALIASES: Record<string, FinanceEventType> = {
  "OrderCharge": "ORDER_CHARGE",
  "OrderFee": "OTHER_FEE",
  "RefundEvent": "REFUND",
  "FBAFee": "FBA_FEE",
  "Commission": "COMMISSION",
  "Advertising": "ADVERTISING",
  "Settlement": "SETTLEMENT",
  "Reimbursement": "REIMBURSEMENT",
  "StorageFee": "STORAGE_FEE",
};

export function classifyFinanceEvent(rawType: string | null | undefined): FinanceEventType {
  if (typeof rawType !== "string" || !rawType.trim()) return "UNKNOWN";
  const normalized = rawType.trim().toLowerCase().replace(/[\s_-]/g, "");
  for (const [alias, type] of Object.entries(EVENT_TYPE_ALIASES)) {
    if (alias.toLowerCase().replace(/[\s_-]/g, "") === normalized) return type;
  }
  return "UNKNOWN";
}

export type FinanceEventScope = {
  organizationId: string;
  workspaceId: string;
};

export type FinanceEventIdentity = FinanceEventScope & {
  amazonOrderId: string;
  orderItemId?: string | null;
  sku?: string | null;
  eventType: string;
  currency: string;
  postedDate?: string | null;
  sourceRunId?: string | null;
};

/**
 * 订单级财务事件的经济键（幂等去重键）：
 * org|ws|amazonOrderId|orderItemId|sku|eventType|postedDate|currency
 * 同一订单行、同一事件类型、同一发布日、同一币种只应入一次。
 */
export function financeEventEconomicKey(e: FinanceEventIdentity): string {
  need(e.amazonOrderId, "amazonOrderId");
  need(e.eventType, "eventType");
  need(e.currency, "currency");
  return [e.organizationId, e.workspaceId, seg(e.amazonOrderId), seg(e.orderItemId), seg(e.sku),
    classifyFinanceEvent(e.eventType), seg(e.postedDate), seg(e.currency)].join("|");
}

/** 一条待落库的订单财务事件形状（金额由调用方以 6 位定点字符串给出）。 */
export type OrderFinanceEventRow = {
  economicKey: string;
  organizationId: string;
  workspaceId: string;
  amazonOrderId: string;
  orderItemId: string | null;
  sku: string | null;
  ftype: FinanceEventType;
  amount: string;
  currency: string;
  postedDate: string | null;
  sourceRunId: string | null;
};

export function buildOrderFinanceEventRow(
  e: FinanceEventIdentity,
  amount: string,
): OrderFinanceEventRow {
  if (typeof amount !== "string" || !/^-?\d{1,24}(?:\.\d{1,6})?$/.test(amount)) fail("事件金额须为最多六位小数十进制字符串。");
  return {
    economicKey: financeEventEconomicKey(e),
    organizationId: e.organizationId,
    workspaceId: e.workspaceId,
    amazonOrderId: e.amazonOrderId,
    orderItemId: e.orderItemId ?? null,
    sku: e.sku ?? null,
    ftype: classifyFinanceEvent(e.eventType),
    amount,
    currency: e.currency,
    postedDate: e.postedDate ?? null,
    sourceRunId: e.sourceRunId ?? null,
  };
}

/** 去重：按 economicKey 保留首次出现，重复计数显式返回，绝不静默覆盖。 */
export function dedupeFinanceEvents(rows: readonly OrderFinanceEventRow[]) {
  const seen = new Set<string>();
  const kept: OrderFinanceEventRow[] = [];
  let duplicates = 0;
  for (const row of rows) {
    if (seen.has(row.economicKey)) { duplicates++; continue; }
    seen.add(row.economicKey);
    kept.push(row);
  }
  return { kept, duplicates };
}

/* -------------------------------------------------------------------------- */
/* 链路主键：财务/退货/结算 → 订单行 → 原始报告行反查                          */
/* -------------------------------------------------------------------------- */

export type BusinessLinkKey = {
  organizationId: string;
  workspaceId: string;
  /** 下游凭证侧身份：财务事件 economicKey / 退货 transactionId / 结算行 settlementId+rowNumber。 */
  downstreamKind: "FINANCE_EVENT" | "RETURN" | "SETTLEMENT" | "ADS_SPEND";
  downstreamId: string;
};

/** 业务链路键：把下游单据锚定到可反查的命名空间。 */
export function businessLinkKey(link: BusinessLinkKey): string {
  need(link.downstreamId, "downstreamId");
  if (!["FINANCE_EVENT", "RETURN", "SETTLEMENT", "ADS_SPEND"].includes(link.downstreamKind)) fail("未知下游单据类型。");
  return ["bizlink", link.organizationId, link.workspaceId, link.downstreamKind, seg(link.downstreamId)].join("|");
}

export type OrderLinkIdentity = FinanceEventScope & {
  amazonOrderId: string;
  orderItemId?: string | null;
  marketplaceId?: string | null;
  /** 原始报告行身份（Run + 行号 + 报告类型），用于反查 fields(Json)。 */
  sourceRunId?: string | null;
  reportType?: string | null;
  rowNumber?: number | string | null;
};

/** 从下游反查订单行的关联键：org|ws|orderId|orderItemId|marketplaceId。 */
export function orderRowLookupKey(o: OrderLinkIdentity): string {
  need(o.amazonOrderId, "amazonOrderId");
  return [o.organizationId, o.workspaceId, seg(o.amazonOrderId), seg(o.orderItemId), seg(o.marketplaceId)].join("|");
}

/** 从订单行反查原始报告行的键：runId|reportType|rowNumber（空则显式缺失）。 */
export function reportRowLookupKey(o: OrderLinkIdentity): string {
  return [seg(o.sourceRunId), seg(o.reportType), o.rowNumber === null || o.rowNumber === undefined || o.rowNumber === "" ? "*" : String(o.rowNumber)].join("|");
}
