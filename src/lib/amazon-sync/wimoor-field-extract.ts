/**
 * Wimoor 缺口字段——从原始报告行 Json 提取映射。
 *
 * 本项目架构：报告原始单元格保留在 AmazonSyncReportRow.fields(Json) / 各快照的 Json 列，
 * 未提升为显式列的 SP-API 元素不丢弃（核对表 §5.5 红线）。因此对于文档中标注 🟡/部分 🔴
 * 的「源报告有明确元素」字段，正确做法不是凭空建空列+灌数，而是提供健壮的提取映射，
 * 在读取时即时反映原始行已保留的真实值。
 *
 * 提取原则：
 * - 多别名：SP-API 不同报告版本表头可能不同（如 item-tax / ItemTax / item_tax），按优先级匹配。
 * - 空值不补零：源空字符串/null/缺失一律返回 null，不落 0（核对表 §6.3 空值口径）。
 * - 保真：返回原始字符串，金额/日期精度由展示层处理。
 * - 来源标记：返回 { value, matchedKey }，便于审计取值来自哪个源键。
 */

export type ExtractedField = {
  /** 原始值（保真字符串）；缺失为 null */
  value: string | null;
  /** 命中的源键（审计用）；未命中为 null */
  matchedKey: string | null;
  /** 是否为源端显式空值（键存在但值为空） */
  explicitlyEmpty: boolean;
};

/** 字段提取定义：规范名 + 别名列表（按优先级）。 */
export type FieldExtractSpec = {
  canonical: string;
  aliases: string[];
  /** 该字段对应的 Wimoor prop（用于看板展示） */
  wimoorProp: string;
  /** SP-API 报告元素（实证） */
  spapiElement: string;
};

type RawFields = Record<string, unknown> | null | undefined;

/**
 * 从原始行 Json 提取单字段。
 * 归一化匹配：先精确命中，再对键做小写+去分隔符匹配，兼容表头大小写/下划线差异。
 */
export function extractField(fields: RawFields, spec: FieldExtractSpec): ExtractedField {
  if (!fields || typeof fields !== "object") return { value: null, matchedKey: null, explicitlyEmpty: false };

  // 1) 精确命中（按 canonical + aliases 优先级）
  for (const key of [spec.canonical, ...spec.aliases]) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      const raw = fields[key];
      const value = normalizeCell(raw);
      return { value, matchedKey: key, explicitlyEmpty: value === null };
    }
  }

  // 2) 归一化命中：小写 + 仅保留字母数字
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedIndex = new Map<string, string>();
  for (const k of Object.keys(fields)) normalizedIndex.set(norm(k), k);
  for (const key of [spec.canonical, ...spec.aliases]) {
    const hit = normalizedIndex.get(norm(key));
    if (hit !== undefined) {
      const value = normalizeCell(fields[hit]);
      return { value, matchedKey: hit, explicitlyEmpty: value === null };
    }
  }

  return { value: null, matchedKey: null, explicitlyEmpty: false };
}

function normalizeCell(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s.length === 0 ? null : s;
}

/** 批量提取：返回规范名 → 提取结果。 */
export function extractFields(fields: RawFields, specs: FieldExtractSpec[]): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  for (const spec of specs) out[spec.canonical] = extractField(fields, spec);
  return out;
}

// ===== 缺口字段提取规格（文档 §4 中「源报告有明确元素」项）=====

/** 订单行税费/折扣/运费（Orders API OrderItem 元素）。 */
export const ORDER_ITEM_FEE_SPECS: FieldExtractSpec[] = [
  { canonical: "item-tax", aliases: ["ItemTax", "item_tax"], wimoorProp: "itemTax", spapiElement: "OrderItem.ItemTax" },
  { canonical: "shipping-tax", aliases: ["ShippingTax", "shipping_tax"], wimoorProp: "shippingTax", spapiElement: "OrderItem.ShippingTax" },
  { canonical: "promotion-discount", aliases: ["PromotionDiscount", "promotion_discount", "PromotionDiscountAmount"], wimoorProp: "promotionDiscount", spapiElement: "OrderItem.PromotionDiscount" },
  { canonical: "shipping-price", aliases: ["ShippingPrice", "shipping_price"], wimoorProp: "shippingAmount", spapiElement: "OrderItem.ShippingPrice" },
  { canonical: "gift-wrap-price", aliases: ["GiftWrapPrice", "gift_wrap_price"], wimoorProp: "giftWrapPrice", spapiElement: "OrderItem.GiftWrapPrice" },
  { canonical: "points-granted", aliases: ["PointsGranted", "points_granted"], wimoorProp: "pointsGranted", spapiElement: "OrderItem.PointsGranted" },
  { canonical: "condition-note", aliases: ["ConditionNote", "condition_note"], wimoorProp: "conditionNote", spapiElement: "OrderItem.ConditionNote" },
];

/** 退货行金额/购买日期/留言/追踪号（Returns 报告元素）。 */
export const RETURN_FIELDS_SPECS: FieldExtractSpec[] = [
  { canonical: "refunded-amount", aliases: ["RefundedAmount", "refunded_amount"], wimoorProp: "itemPrice", spapiElement: "returns report refunded-amount" },
  { canonical: "purchase-date", aliases: ["PurchaseDate", "purchase_date"], wimoorProp: "purchaseDate", spapiElement: "returns report purchase-date" },
  { canonical: "customer-comments", aliases: ["CustomerComments", "customer_comments"], wimoorProp: "customerComments", spapiElement: "returns report customer-comments" },
  { canonical: "license-plate-number", aliases: ["LicensePlateNumber", "license_plate_number", "tracking-id"], wimoorProp: "licensePlateNumber", spapiElement: "returns report license-plate-number" },
  { canonical: "detailed-disposition-name", aliases: ["DetailedDispositionName", "detailed_disposition_name"], wimoorProp: "detailedDispositionName", spapiElement: "returns report detailed-disposition-name" },
  { canonical: "reason-description", aliases: ["ReasonDescription", "reason_description"], wimoorProp: "reasonname", spapiElement: "returns report reason-description" },
];

/** 流量浏览比率字段（Sales & Traffic 报告直采，非派生）。 */
export const TRAFFIC_RATE_SPECS: FieldExtractSpec[] = [
  { canonical: "sessionPercentage", aliases: ["SessionPercentage", "session-percentage", "session_percentage"], wimoorProp: "sessionPercentage", spapiElement: "Sales&Traffic sessionPercentage" },
  { canonical: "pageViewsPercentage", aliases: ["PageViewsPercentage", "page-views-percentage", "page_views_percentage"], wimoorProp: "pageViewsPercentage", spapiElement: "Sales&Traffic pageViewsPercentage" },
  { canonical: "buyBoxPercentage", aliases: ["BuyBoxPercentage", "buy-box-percentage", "buy_box_percentage"], wimoorProp: "buyBoxPercentage", spapiElement: "Sales&Traffic buyBoxPercentage" },
  { canonical: "unitSessionPercentage", aliases: ["UnitSessionPercentage", "unit-session-percentage", "unit_session_percentage"], wimoorProp: "unitSessionPercentage", spapiElement: "Sales&Traffic unitSessionPercentage" },
];

/** 库存分站点（AFN Inventory by Country 报告元素）。 */
export const INVENTORY_BY_COUNTRY_SPECS: FieldExtractSpec[] = [
  { canonical: "country", aliases: ["Country", "country-code"], wimoorProp: "country", spapiElement: "BY_COUNTRY country" },
  { canonical: "quantity-for-local-fulfillment", aliases: ["QuantityForLocalFulfillment", "quantity_for_local_fulfillment"], wimoorProp: "afnWarehouseQuantity", spapiElement: "BY_COUNTRY quantity-for-local-fulfillment" },
  { canonical: "fulfillment-center-id", aliases: ["FulfillmentCenterId", "fulfillment_center_id"], wimoorProp: "warehouse", spapiElement: "fulfillment-center-id" },
];

/** 广告同/跨 SKU 归因 + 分窗口（Advertising 报告元素，fact 表 rawDimensions Json）。 */
export const ADS_ATTRIBUTION_SPECS: FieldExtractSpec[] = [
  { canonical: "attributedSalesSameSku", aliases: ["attributedSalesSameSKU", "attributed-sales-same-sku", "attributedSalesSameSku7d"], wimoorProp: "attributedSalesSameSKU", spapiElement: "ads attributedSalesSameSKU" },
  { canonical: "attributedSalesOtherSku", aliases: ["attributedSales", "attributed-sales", "attributedSalesOtherSKU"], wimoorProp: "attributedSales", spapiElement: "ads attributedSales (cross-SKU)" },
  { canonical: "attributedConversionsSameSku", aliases: ["attributedConversionsSameSKU", "attributed-conversions-same-sku"], wimoorProp: "attributedConversionsSameSKU", spapiElement: "ads attributedConversionsSameSKU" },
  { canonical: "attributedConversionsOtherSku", aliases: ["attributedConversions", "attributed-conversions"], wimoorProp: "attributedConversions", spapiElement: "ads attributedConversions (cross-SKU)" },
  { canonical: "attributedSales1d", aliases: ["sales1d", "attributedSales1d"], wimoorProp: "sales1d", spapiElement: "ads attributedSales 1d" },
  { canonical: "attributedSales7d", aliases: ["sales7d", "attributedSales7d"], wimoorProp: "sales7d", spapiElement: "ads attributedSales 7d" },
  { canonical: "attributedSales14d", aliases: ["sales14d", "attributedSales14d"], wimoorProp: "sales14d", spapiElement: "ads attributedSales 14d" },
  { canonical: "attributedSales30d", aliases: ["sales30d", "attributedSales30d"], wimoorProp: "sales30d", spapiElement: "ads attributedSales 30d" },
];

/** 全部提取规格按域分组，供 API/看板枚举。 */
export const FIELD_EXTRACT_GROUPS: Array<{ domain: string; specs: FieldExtractSpec[] }> = [
  { domain: "订单行费用", specs: ORDER_ITEM_FEE_SPECS },
  { domain: "退货行", specs: RETURN_FIELDS_SPECS },
  { domain: "流量比率", specs: TRAFFIC_RATE_SPECS },
  { domain: "库存分站点", specs: INVENTORY_BY_COUNTRY_SPECS },
  { domain: "广告归因", specs: ADS_ATTRIBUTION_SPECS },
];
