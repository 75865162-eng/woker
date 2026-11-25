/**
 * WIMOOR 库存落地页 → 亚马逊真实库存数据适配层。
 *
 * 背景：WIMOOR 迁移页（FBA库存/FBA每日库存/每日库存）原只读通用主数据表，
 * 而亚马逊真实库存落在 AmazonInventorySnapshot（已发布 run）。本适配层把
 * /api/operations/inventory/snapshots 返回的行映射成 WIMOOR 库存页列格式，
 * 让落地页打开即显示亚马逊真实返回的库存数据。
 *
 * 红线（与全局一致）：
 * - 不造数：无真实来源的字段（安全库存周期/头程成本等）返回 null，前端显示"—"；
 * - 不臆造：数量直接取真实字段，不用 0 补齐缺失分量；
 * - 分站点：marketplaceId 原样透传，不跨站点相加。
 */

/** 真实库存 API 单行（仅声明本适配用到的字段，其余字段忽略）。 */
export type AmazonInventoryRow = {
  id?: string;
  sellerSku?: string | null;
  asin?: string | null;
  fnSku?: string | null;
  marketplaceId?: string | null;
  sellerAccountId?: string | null;
  condition?: string | null;
  fulfillableQuantity?: number | null;
  inboundWorkingQuantity?: number | null;
  inboundShippedQuantity?: number | null;
  inboundReceivingQuantity?: number | null;
  reservedQuantity?: number | null;
  unfulfillableQuantity?: number | null;
  researchingQuantity?: number | null;
  capturedAt?: string | null;
};

/** WIMOOR 库存落地页的通用行形状。 */
export type WimoorInventoryRow = Record<string, unknown> & {
  id: string;
  source: "amazon_inventory_snapshot";
};

/** 数量分量：仅当真实值为有限数时返回，否则 null（不补零）。 */
function qty(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 把一条亚马逊真实库存行映射为 WIMOOR FBA库存页列。
 * 库存合计（afnWarehouseQuantity）在分量齐全时相加，任一分量缺失则为 null（不臆造）。
 */
export function mapAmazonInventoryToFbaRow(
  row: AmazonInventoryRow,
  fallbackIndex = 0,
): WimoorInventoryRow {
  const fulfillable = qty(row.fulfillableQuantity);
  const working = qty(row.inboundWorkingQuantity);
  const shipped = qty(row.inboundShippedQuantity);
  const receiving = qty(row.inboundReceivingQuantity);
  const reserved = qty(row.reservedQuantity);
  const unfulfillable = qty(row.unfulfillableQuantity);
  const researching = qty(row.researchingQuantity);
  const parts = [fulfillable, working, shipped, receiving, reserved, unfulfillable, researching];
  const total = parts.every((v) => v !== null)
    ? parts.reduce<number>((sum, v) => sum + (v ?? 0), 0)
    : null;
  return {
    id: row.id ?? `amazon-inv-${fallbackIndex}`,
    source: "amazon_inventory_snapshot",
    name: row.sellerSku ?? null,
    sku: row.sellerSku ?? null,
    sellerSku: row.sellerSku ?? null,
    asin: row.asin ?? null,
    fnSku: row.fnSku ?? null,
    warehouse: row.marketplaceId ?? null,
    marketplaceId: row.marketplaceId ?? null,
    condition: row.condition ?? null,
    afnWarehouseQuantity: total,
    afnFulfillableQuantity: fulfillable,
    afnReservedQuantity: reserved,
    afnInboundWorkingQuantity: working,
    afnInboundShippedQuantity: shipped,
    afnInboundReceivingQuantity: receiving,
    afnUnsellableQuantity: unfulfillable,
    afnResearchingQuantity: researching,
    capturedAt: row.capturedAt ?? null,
    // 无真实来源的 WIMOOR 列留空，不造数
    stockingCycle: null,
    minCycle: null,
    firstLegCharges: null,
  };
}

/** 映射一批真实库存行；保持 API 返回顺序（已按 sellerSku 排序）。 */
export function mapAmazonInventoryRows(rows: readonly AmazonInventoryRow[]): WimoorInventoryRow[] {
  return rows.map((r, i) => mapAmazonInventoryToFbaRow(r, i));
}

/** 落地页取数口径说明（供页面展示，说明数据来源与不造数原则）。 */
export const AMAZON_INVENTORY_PAGE_BASIS =
  "数据来自亚马逊 SP-API 已发布库存快照（AmazonInventorySnapshot），按站点原样返回；" +
  "安全库存周期/头程成本等无真实来源的字段显示—，不以 0 或伪造值填充。";
