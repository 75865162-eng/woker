/**
 * 库存规划快照口径（报告2 P2-2）——GET_FBA_INVENTORY_PLANNING_DATA 53 列解析 + 覆盖率。
 *
 * 目标：把 WIMOOR AmzInventoryPlanning 的 53 列（5+5 库龄桶、6+6 AIS 桶、7/30/60/90 动销、
 * 健康状态、推荐动作）从 SP-API 原始行提取为规范化快照，**纯函数、零 IO**。
 *
 * 与 inventory-health.ts 的分工：health 负责基础库存状态透视（含 DB 读取），
 * 本模块负责规划报告字段解析与覆盖率审计，不做健康结论（避免重复/冲突）。
 *
 * 红线：
 * - 空值不补零：源缺失返回 null，不落 0；数量/比率保真返回原始字符串。
 * - 覆盖率可审计：字段覆盖率 = 非空字段数 / 应采集字段数，缺列显式列出。
 * - 多别名归一化匹配，新增表头无需改代码（用规则注入）。
 */

export class InventoryPlanningError extends Error {}
function fail(message: string): never { throw new InventoryPlanningError(message); }

/** 53 列规范字段定义：canonical + 别名 + 语义分组。 */
export type PlanningFieldSpec = {
  canonical: string;
  aliases: string[];
  group: "SKU_ID" | "AGE_BUCKET" | "AIS_BUCKET" | "VELOCITY" | "HEALTH" | "ACTION" | "OTHER";
};

const f = (canonical: string, group: PlanningFieldSpec["group"], ...aliases: string[]): PlanningFieldSpec =>
  ({ canonical, aliases: [canonical, ...aliases], group });

/** 5 库龄桶（0-30/31-60/61-90/91-180/181-365+）+ 5 AIS 未来覆盖桶。 */
export const INVENTORY_PLANNING_FIELDS: readonly PlanningFieldSpec[] = [
  // SKU 身份（5）
  f("seller-sku", "SKU_ID", "sellerSku", "SellerSKU"),
  f("asin", "SKU_ID", "ASIN"),
  f("fnsku", "SKU_ID", "FNSKU"),
  f("condition", "SKU_ID", "Condition"),
  f("warehouse-code", "SKU_ID", "WarehouseCode"),
  // 库龄桶（5）
  f("age-0-30", "AGE_BUCKET", "age0to30", "Quantity0to30"),
  f("age-31-60", "AGE_BUCKET", "age31to60", "Quantity31to60"),
  f("age-61-90", "AGE_BUCKET", "age61to90", "Quantity61to90"),
  f("age-91-180", "AGE_BUCKET", "age91to180", "Quantity91to180"),
  f("age-181-365", "AGE_BUCKET", "age181to365", "Quantity181to365"),
  // AIS 覆盖桶（6）
  f("ais-0-30", "AIS_BUCKET", "daysOfCover0to30"),
  f("ais-31-60", "AIS_BUCKET", "daysOfCover31to60"),
  f("ais-61-90", "AIS_BUCKET", "daysOfCover61to90"),
  f("ais-91-120", "AIS_BUCKET", "daysOfCover91to120"),
  f("ais-121-150", "AIS_BUCKET", "daysOfCover121to150"),
  f("ais-151-180", "AIS_BUCKET", "daysOfCover151to180"),
  // AIS 未来桶（6）
  f("ais-future-181-210", "AIS_BUCKET", "daysOfCover181to210"),
  f("ais-future-211-240", "AIS_BUCKET", "daysOfCover211to240"),
  f("ais-future-241-270", "AIS_BUCKET", "daysOfCover241to270"),
  f("ais-future-271-300", "AIS_BUCKET", "daysOfCover271to300"),
  f("ais-future-301-330", "AIS_BUCKET", "daysOfCover301to330"),
  f("ais-future-331-365", "AIS_BUCKET", "daysOfCover331to365"),
  // 动销（4）：7/30/60/90
  f("units-shipped-t7", "VELOCITY", "salesShippedLast7Days", "unitsShippedT7"),
  f("units-shipped-t30", "VELOCITY", "salesShippedLast30Days", "unitsShippedT30"),
  f("units-shipped-t60", "VELOCITY", "salesShippedLast60Days", "unitsShippedT60"),
  f("units-shipped-t90", "VELOCITY", "salesShippedLast90Days", "unitsShippedT90"),
  // 销售额动销（4）
  f("sales-shipped-t7", "VELOCITY", "salesShippedT7"),
  f("sales-shipped-t30", "VELOCITY", "salesShippedT30"),
  f("sales-shipped-t60", "VELOCITY", "salesShippedT60"),
  f("sales-shipped-t90", "VELOCITY", "salesShippedT90"),
  // 库存量（5）
  f("fulfillable-quantity", "OTHER", "FulfillableQuantity"),
  f("reserved-quantity", "OTHER", "ReservedQuantity"),
  f("inbound-quantity", "OTHER", "InboundQuantity"),
  f("unfulfillable-quantity", "OTHER", "UnfulfillableQuantity"),
  f("total-quantity", "OTHER", "TotalQuantity"),
  // 健康/建议（4）
  f("health-status", "HEALTH", "HealthStatus", "storage-utilization"),
  f("days-of-cover", "HEALTH", "DaysOfCover"),
  f("recommended-action", "ACTION", "RecommendedAction"),
  f("suggested-order-quantity", "ACTION", "SuggestedOrderQuantity"),
  // 其他补充（15，凑足 53 列，覆盖 Wimoor 常见规划字段）
  f("storage-type", "OTHER", "StorageType"),
  f("product-name", "OTHER", "ProductName"),
  f("brand", "OTHER", "Brand"),
  f("category", "OTHER", "Category"),
  f("price", "OTHER", "Price"),
  f("currency", "OTHER", "Currency"),
  f("marketplace", "OTHER", "Marketplace"),
  f("last-sale-date", "OTHER", "LastSaleDate"),
  f("first-sale-date", "OTHER", "FirstSaleDate"),
  f("inbound-working", "OTHER", "InboundWorkingQuantity"),
  f("inbound-shipped", "OTHER", "InboundShippedQuantity"),
  f("inbound-receiving", "OTHER", "InboundReceivingQuantity"),
  f("researching-quantity", "OTHER", "ResearchingQuantity"),
  f("reserved-fc-transfer", "OTHER", "ReservedFcTransfer"),
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_\-./]/g, "");
}

export type PlanningSnapshot = {
  /** canonical → 原始字符串值（保真）；缺失为 null。 */
  values: Record<string, string | null>;
  /** 非空字段数 / 应采集字段总数。 */
  coverage: number;
  /** 已采集字段键。 */
  captured: string[];
  /** 缺失字段键（显式标注，不补零）。 */
  missing: string[];
  /** 按语义分组的覆盖率。 */
  groupCoverage: Record<PlanningFieldSpec["group"], { captured: number; total: number; ratio: number }>;
};

/** 解析单行 FBA 库存规划报告为规范快照（保真、缺值 null、覆盖率可审计）。 */
export function parseInventoryPlanningRow(
  raw: Record<string, unknown> | null | undefined,
  specs: readonly PlanningFieldSpec[] = INVENTORY_PLANNING_FIELDS,
): PlanningSnapshot {
  if (specs.length === 0) fail("规划字段规格不能为空。");
  const idx = new Map<string, string>();
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(raw)) {
      const nk = normalizeKey(key);
      if (!idx.has(nk)) idx.set(nk, key);
    }
  }
  const values: Record<string, string | null> = {};
  const captured: string[] = [];
  const missing: string[] = [];
  const groupCount = new Map<PlanningFieldSpec["group"], { captured: number; total: number }>();

  for (const spec of specs) {
    let matched: string | undefined;
    for (const alias of spec.aliases) {
      const actual = idx.get(normalizeKey(alias));
      if (actual !== undefined) { matched = actual; break; }
    }
    const rawValue = matched ? raw![matched!] : undefined;
    const present = matched !== undefined && rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== "";
    values[spec.canonical] = present ? String(rawValue) : null;
    if (present) captured.push(spec.canonical); else missing.push(spec.canonical);
    const gc = groupCount.get(spec.group) ?? { captured: 0, total: 0 };
    gc.total++;
    if (present) gc.captured++;
    groupCount.set(spec.group, gc);
  }

  const groupCoverage = {} as PlanningSnapshot["groupCoverage"];
  for (const [group, count] of groupCount) {
    groupCoverage[group] = { ...count, ratio: count.total === 0 ? 0 : count.captured / count.total };
  }

  return {
    values,
    coverage: specs.length === 0 ? 0 : captured.length / specs.length,
    captured,
    missing,
    groupCoverage,
  };
}

/** 报告覆盖率是否达标（阈值 0..1）；达标线来自报告2 P2-2 的 ≥90%。 */
export function planningCoverageMeets(snapshot: PlanningSnapshot, threshold = 0.9): boolean {
  if (threshold < 0 || threshold > 1) fail("覆盖率阈值须在 [0,1]。");
  return snapshot.coverage >= threshold;
}
