import { assertOrderAccessEvidence, type OrderAccessContext } from "./order-access-evidence";
import { createHash } from "node:crypto";
import { SyncInputError } from "./policy";

/** Executable non-PII parser versions, independent of the upstream API version. */
export const orderParserVersion = "orders.2026-01-01.v2";
export const orderFactSchemaVersion = "orders.non-pii.v2";

/** Orders v2026-01-01 dataset/role contracts. P2 deliberately supports only
 * these reviewed datasets; missing PII is not proof of a missing role.
 * https://developer-docs.amazon.com/sp-api/reference/getorder-3
 * https://developer-docs.amazon.com/sp-api/docs/access-orders-pii
 */
export const orderDetailDatasets = ["FULFILLMENT", "PROCEEDS", "BUYER", "RECIPIENT"] as const;
export type OrderDetailPolicy = { includedData: Array<typeof orderDetailDatasets[number]>; requiredRoles: string[]; purpose: string; requestsPerSecond: number; burst: number; maxOrders: number; accessEvidence?: string; backfillExisting?: boolean };
const orderOperationRoles = ["Amazon Fulfillment", "Buyer Communication", "Buyer Solicitation", "Finance and Accounting", "Inventory and Order Tracking", "Pricing", "Product Listing", "Professional Services (Restricted)", "Selling Partner Insights", "Direct-to-Consumer Shipping (Restricted)", "Tax Invoicing (Restricted)", "Tax Remittance (Restricted)"];

/** Orders API 2026-01-01. Official operation/schema (no v0 parameters):
 * https://developer-docs.amazon.com/sp-api/reference/searchorders
 * https://github.com/amzn/selling-partner-api-models/blob/main/models/orders-api-model/orders_2026-01-01.json
 */
export type OrderSyncPolicy = {
  initialFrom: string;
  windowMinutes: number;
  overlapSeconds: number;
  safetyLagSeconds: number;
  marketplaceTimeZone: string;
  applicationId: string;
  requestsPerSecond: number;
  burst: number;
  statusMapping: Record<string, string>;
  requiredRoles: string[];
  details?: OrderDetailPolicy;
};

export type OrderWindow = { from: string; to: string };

export function orderCursorDigest(cursor: { id: string; activeRunId: string | null; status: string; watermarkFrom: Date; watermarkTo: Date; nextTokenCiphertext: string | null; listComplete: boolean; detailPolicyDigest: string | null }) {
  const frozen = [cursor.id, cursor.activeRunId, cursor.status, cursor.watermarkFrom.toISOString(), cursor.watermarkTo.toISOString(), cursor.nextTokenCiphertext, cursor.listComplete, cursor.detailPolicyDigest];
  return createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
}

function utc(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new SyncInputError("订单时间须为有效 UTC 时间。");
  const result = new Date(value).toISOString();
  if (result.replace(".000Z", "Z") !== value.replace(".000Z", "Z")) throw new SyncInputError("订单时间不存在。");
  return result;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new SyncInputError("订单窗口或预算配置超出范围。");
  return value;
}
export function parseOrderSyncPolicy(value: unknown): OrderSyncPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("请先配置订单增量策略。");
  const p = value as Record<string, unknown>;
  const initialFrom = utc(p.initialFrom);
  if (typeof p.marketplaceTimeZone !== "string" || p.marketplaceTimeZone.length > 100) throw new SyncInputError("订单站点时区缺失。");
  try { new Intl.DateTimeFormat("en", { timeZone: p.marketplaceTimeZone }).format(); } catch { throw new SyncInputError("订单站点时区无效。"); }
  if (typeof p.applicationId !== "string" || !/^[a-zA-Z0-9._:-]{1,200}$/.test(p.applicationId)) throw new SyncInputError("订单同步须提供非敏感应用标识。");
  if (typeof p.requestsPerSecond !== "number" || !Number.isFinite(p.requestsPerSecond) || p.requestsPerSecond <= 0 || p.requestsPerSecond > 0.0056) throw new SyncInputError("订单 searchOrders 预算不能超过 0.0056 请求/秒。");
  const mapping = p.statusMapping;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping) || Object.keys(mapping).length > 100 || Object.entries(mapping).some(([k, v]) => !/^[A-Z][A-Z0-9_]{0,99}$/.test(k) || typeof v !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(v))) throw new SyncInputError("订单状态映射须为状态代码映射，未知状态保留原值。");
  const requiredRoles = p.requiredRoles ?? [];
  if (!Array.isArray(requiredRoles) || requiredRoles.length > 20 || requiredRoles.some(r => typeof r !== "string" || !/^[A-Za-z][A-Za-z0-9 ()&/-]{0,99}$/.test(r))) throw new SyncInputError("历史订单角色元数据格式无效。");
  const windowMinutes = integer(p.windowMinutes, 1, 1440), overlapSeconds = integer(p.overlapSeconds, 1, 3600);
  if (overlapSeconds >= windowMinutes * 60) throw new SyncInputError("订单回查重叠必须小于窗口长度。");
  return { initialFrom, windowMinutes, overlapSeconds, safetyLagSeconds: integer(p.safetyLagSeconds, 120, 86400), marketplaceTimeZone: p.marketplaceTimeZone, applicationId: p.applicationId, requestsPerSecond: p.requestsPerSecond, burst: integer(p.burst, 1, 20), statusMapping: { ...mapping } as Record<string, string>, requiredRoles: [...new Set(requiredRoles as string[])], ...(p.details === undefined ? {} : { details: parseDetailPolicy(p.details) }) };
}

function parseDetailPolicy(value: unknown): OrderDetailPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("订单详情策略无效；不启用时请省略 details。");
  const p = value as Record<string, unknown>;
  if (!Array.isArray(p.includedData) || p.includedData.length > orderDetailDatasets.length || p.includedData.some(d => !orderDetailDatasets.includes(d))) throw new SyncInputError("订单详情数据集不在本阶段已核验范围内。");
  const requiredRoles = p.requiredRoles ?? [];
  if (!Array.isArray(requiredRoles) || requiredRoles.length > 20 || requiredRoles.some(r => !orderOperationRoles.includes(r))) throw new SyncInputError("历史订单详情角色元数据格式无效。");
  if (typeof p.purpose !== "string" || !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$/.test(p.purpose)) throw new SyncInputError("订单详情须填写非敏感业务用途代码。");
  if (typeof p.requestsPerSecond !== "number" || !Number.isFinite(p.requestsPerSecond) || p.requestsPerSecond <= 0 || p.requestsPerSecond > 0.5) throw new SyncInputError("getOrder 预算不得超过 0.5 请求/秒。");
  if (p.accessEvidence !== undefined && (typeof p.accessEvidence !== "string" || !p.accessEvidence || p.accessEvidence.length > 12000)) throw new SyncInputError("订单接口能力证据格式无效。");
  if (p.backfillExisting !== undefined && typeof p.backfillExisting !== "boolean") throw new SyncInputError("订单补齐范围无效。");
  return { ...(p.accessEvidence ? { accessEvidence: p.accessEvidence as string } : {}), ...(p.backfillExisting === true ? { backfillExisting: true } : {}), includedData: [...new Set(p.includedData)].sort(), requiredRoles: [...new Set(requiredRoles)].sort(), purpose: p.purpose, requestsPerSecond: p.requestsPerSecond, burst: integer(p.burst, 1, 30), maxOrders: integer(p.maxOrders, 1, 5000) };
}

/** Freeze one bounded window per execution approval; an incomplete cursor wins. */
export function nextOrderWindow(policy: OrderSyncPolicy, cursor: { watermarkFrom: Date; watermarkTo: Date; status: string } | null, now: Date): OrderWindow {
  if (cursor && cursor.status !== "SUCCEEDED") return { from: utc(cursor.watermarkFrom.toISOString()), to: utc(cursor.watermarkTo.toISOString()) };
  const initial = Date.parse(policy.initialFrom);
  const from = cursor ? Math.max(initial, cursor.watermarkTo.getTime() - policy.overlapSeconds * 1000) : initial;
  const to = Math.min(from + policy.windowMinutes * 60_000, now.getTime() - policy.safetyLagSeconds * 1000);
  if (to <= from || (cursor && to <= cursor.watermarkTo.getTime())) throw new SyncInputError("订单增量窗口尚无新数据，请稍后重新申请。", 409);
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export function orderWindowFromFrozen(value: unknown): OrderWindow {
  const w = value as { from?: unknown; to?: unknown } | null;
  const from = utc(w?.from), to = utc(w?.to);
  if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 86400_000) throw new SyncInputError("订单执行窗口无效。");
  return { from, to };
}

export type OrderPage = {
  orders: Array<{ amazonOrderId: string; marketplaceId: string; createdTime: Date; sourceUpdatedAt: Date; rawStatus: string | null; normalizedStatus: string | null }>;
  nextToken?: string;
};

export function parseOrderPage(value: unknown, marketplaceId: string, policy: OrderSyncPolicy, window: OrderWindow): OrderPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("订单响应格式无效。");
  const root = value as { orders?: unknown; pagination?: { nextToken?: unknown }; lastUpdatedBefore?: unknown };
  if (!Array.isArray(root.orders)) throw new SyncInputError("订单响应缺少 orders。");
  if (root.lastUpdatedBefore !== undefined && (typeof root.lastUpdatedBefore !== "string" || Date.parse(root.lastUpdatedBefore) !== Date.parse(window.to))) throw new SyncInputError("订单响应的有效窗口与审批窗口不一致。");
  const seen = new Set<string>();
  const orders = root.orders.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SyncInputError("订单行格式无效。");
    const row = raw as Record<string, unknown>;
    const amazonOrderId = typeof row.orderId === "string" ? row.orderId.trim() : "";
    const timestamp = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v) : null;
    const createdTime = timestamp(row.createdTime), sourceUpdatedAt = timestamp(row.lastUpdatedTime);
    const channel = row.salesChannel && typeof row.salesChannel === "object" ? row.salesChannel as Record<string, unknown> : null;
    const status = row.fulfillment && typeof row.fulfillment === "object" ? (row.fulfillment as Record<string, unknown>).fulfillmentStatus : null;
    if (!amazonOrderId || amazonOrderId.length > 200 || !createdTime || !sourceUpdatedAt || createdTime > sourceUpdatedAt || channel?.marketplaceId !== marketplaceId || (status !== null && status !== undefined && (typeof status !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(status)))) throw new SyncInputError("订单缺少非PII关键字段。");
    if (sourceUpdatedAt < new Date(window.from) || sourceUpdatedAt > new Date(window.to)) throw new SyncInputError("订单更新时间越出请求窗口。");
    if (seen.has(amazonOrderId)) throw new SyncInputError("订单页含重复订单 ID。");
    seen.add(amazonOrderId);
    return { amazonOrderId, marketplaceId, createdTime, sourceUpdatedAt, rawStatus: typeof status === "string" ? status : null, normalizedStatus: typeof status === "string" && Object.hasOwn(policy.statusMapping, status) ? policy.statusMapping[status] : null };
  });
  if (root.pagination !== undefined && (!root.pagination || typeof root.pagination !== "object" || Array.isArray(root.pagination))) throw new SyncInputError("订单分页结构无效。");
  const nextToken = root.pagination?.nextToken;
  if (nextToken !== undefined && (typeof nextToken !== "string" || nextToken.length > 32000 || !nextToken.trim())) throw new SyncInputError("订单分页 token 无效。");
  return { orders, nextToken: typeof nextToken === "string" ? nextToken : undefined };
}

/** Approved roles are admin-attested metadata, not inferred from marketplace participation. */
export function assertOrderRoles(auth: { approvedRoles: string[]; rolesAttestedAt: Date | null }, policy: OrderSyncPolicy, automaticRead = false, context?: OrderAccessContext & { currentEvidence?: string }) {
  // No manual API-role registry. Preserve verification of explicitly supplied
  // operation evidence; it is never a substitute for account data permissions.
  void auth; void automaticRead;
  if (context && (context.currentEvidence || policy.details?.accessEvidence)) assertOrderAccessEvidence(context.currentEvidence ?? policy.details!.accessEvidence!, { ...context, includedData: policy.details?.includedData ?? [] });
}

export type OrderMoney = { original: string; currency: string };
/** Decimal is a STRING in the official model. NUMERIC(65,30) bounds are checked
 * before persistence: reject unrepresentable values instead of silently rounding.
 */
export function parseOrderMoney(value: unknown): OrderMoney | null {
  if (value === undefined || value === null) return null;
  const p = record(value);
  if (typeof p.amount !== "string" || p.amount.length > 200 || typeof p.currencyCode !== "string" || !/^[A-Z]{3}$/.test(p.currencyCode)) throw new SyncInputError("订单金额或币种格式无效。");
  const match = /^-?(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d{1,4}))?$/.exec(p.amount);
  if (!match) throw new SyncInputError("订单金额必须保留 API 十进制字符串。");
  const exponent = Number(match[3] ?? 0), fraction = match[2] ?? "";
  const significant = `${match[1]}${fraction}`.replace(/^0+/, "");
  const scale = fraction.length - exponent, integerDigits = significant.length - scale;
  if (significant && (scale > 30 || integerDigits > 35)) throw new SyncInputError("订单金额超出可无损存储精度，未舍入或提交。");
  // Bound zero exponents too, preventing unbounded numeric expansion downstream.
  if (Math.abs(exponent) > 1000) throw new SyncInputError("订单金额指数超出安全范围。");
  return { original: p.amount, currency: p.currencyCode };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("订单详情结构无效。");
  return value as Record<string, unknown>;
}
function optionalCode(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.length || value.length > 500) throw new SyncInputError("订单商品标识格式无效。");
  return value;
}
/** Only whitelisted non-PII facts leave this parser. Buyer/address/customization,
 * gift messages and unknown fields stay exclusively in encrypted envelopes.
 */
export function parseOrderDetail(value: unknown, expectedId: string, marketplaceId: string, policy: OrderSyncPolicy, listedAt: Date) {
  const order = record(record(value).order);
  if (order.orderId !== expectedId) throw new SyncInputError("订单详情 ID 与批准范围不匹配。");
  // Reuse the same version's identity/time/status model, not a parallel v0 model.
  const updated = typeof order.lastUpdatedTime === "string" ? new Date(order.lastUpdatedTime) : new Date(NaN);
  const base = parseOrderPage({ orders: [order] }, marketplaceId, policy, { from: listedAt.toISOString(), to: Number.isFinite(updated.getTime()) ? updated.toISOString() : listedAt.toISOString() }).orders[0];
  if (!Array.isArray(order.orderItems) || order.orderItems.length > 1000) throw new SyncInputError("订单详情缺少明细或超出安全容量。");
  const seen = new Set<string>();
  const items = order.orderItems.map(raw => {
    const item = record(raw), product = record(item.product);
    const itemId = optionalCode(item.orderItemId);
    if (!itemId || seen.has(itemId) || typeof item.quantityOrdered !== "number" || !Number.isSafeInteger(item.quantityOrdered) || item.quantityOrdered < 0 || item.quantityOrdered > 2147483647) throw new SyncInputError("订单明细键或数量无效。");
    seen.add(itemId);
    return { orderItemId: itemId, asin: optionalCode(product.asin), sellerSku: optionalCode(product.sellerSku), quantityOrdered: item.quantityOrdered, proceeds: item.proceeds == null ? null : parseOrderMoney(record(item.proceeds).proceedsTotal) };
  });
  const fulfillment = order.fulfillment == null ? {} : record(order.fulfillment);
  return { ...base, fulfilledBy: optionalCode(fulfillment.fulfilledBy), fulfillmentServiceLevel: optionalCode(fulfillment.fulfillmentServiceLevel), grandTotal: order.proceeds == null ? null : parseOrderMoney(record(order.proceeds).grandTotal), items };
}
