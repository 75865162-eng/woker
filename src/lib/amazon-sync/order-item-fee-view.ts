/**
 * 报告2 阶段 P0-3：订单行费用结构化视图。
 *
 * 背景：审计指出 AmazonOrderItemRecord 仅 7 个业务列，ItemTax/ShippingTax/
 * PromotionDiscount/ShippingPrice/GiftWrapPrice/PointsGranted/ConditionNote 只留在
 * AmazonSyncReportRow.fields(Json)，无法结构化透视。
 *
 * 本项目架构红线（见 wimoor-field-extract.ts）：原始单元格永久保留在 Json，
 * 不凭空建空列灌数。因此本模块是**读取时结构化视图**：从原始行 Json 用已有
 * ORDER_ITEM_FEE_SPECS 提取，输出以 Wimoor prop 命名的结构化对象 —— 供展示/对账
 * 即时反映真实值，且不落库、不臆造、空值保持 null。
 *
 * 覆盖率字段用于审计：明确哪些费用项源报告提供了、哪些没有，避免把"未提取到"
 * 误读成"费用为 0"。
 */
import { extractFields, ORDER_ITEM_FEE_SPECS, type ExtractedField } from "./wimoor-field-extract";

export type OrderItemFeeView = {
  /** Wimoor prop → 原始字符串值（保真，缺值 null） */
  fees: Record<string, string | null>;
  /** 每个 prop 的提取来源（命中的源键 / 是否源端显式空值） */
  evidence: Record<string, Pick<ExtractedField, "matchedKey" | "explicitlyEmpty">>;
  /** 提取到的字段数 / 规格总数 */
  coverage: { extracted: number; total: number; ratio: number };
  /** 未命中源键的 prop（不是 0，只是源报告未提供） */
  missing: string[];
};

/**
 * 从一行原始订单行 Json 构造结构化的订单行费用视图。
 * - 只读，不写库；空值不补零；来源可审计。
 */
export function buildOrderItemFeeView(fields: Record<string, unknown> | null | undefined): OrderItemFeeView {
  const extracted = extractFields(fields, ORDER_ITEM_FEE_SPECS);
  const fees: Record<string, string | null> = {};
  const evidence: Record<string, Pick<ExtractedField, "matchedKey" | "explicitlyEmpty">> = {};
  const missing: string[] = [];
  let hit = 0;
  for (const spec of ORDER_ITEM_FEE_SPECS) {
    const result = extracted[spec.canonical];
    fees[spec.wimoorProp] = result.value;
    evidence[spec.wimoorProp] = { matchedKey: result.matchedKey, explicitlyEmpty: result.explicitlyEmpty };
    if (result.matchedKey !== null) hit += 1;
    else missing.push(spec.wimoorProp);
  }
  const total = ORDER_ITEM_FEE_SPECS.length;
  return {
    fees,
    evidence,
    coverage: { extracted: hit, total, ratio: total > 0 ? hit / total : 0 },
    missing,
  };
}

/**
 * 批量视图：多行订单项 → 逐行费用视图。保持输入顺序，实现纯函数化便于测试与复用。
 */
export function buildOrderItemFeeViews(
  rows: Array<{ key: string; fields: Record<string, unknown> | null | undefined }>,
): Array<{ key: string; view: OrderItemFeeView }> {
  return rows.map((row) => ({ key: row.key, view: buildOrderItemFeeView(row.fields) }));
}
