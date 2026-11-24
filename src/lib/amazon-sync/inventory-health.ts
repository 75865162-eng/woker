import { prisma } from "@/lib/db/prisma";
import type { SyncScope } from "./policy";
import { amazonAccountReadAccess } from "./read-account";

/**
 * FBA 库存健康透视（Wimoor FBA 库存 detail + planning 对标，迁移到亚马逊模块）。
 *
 * 口径（保守、不造数）：
 * - 数据源仅 AmazonInventorySnapshot（SP-API FBA Inventory 真实快照），不接赛狐。
 * - 取每个 SKU（按 site=marketplaceId + SKU）最近 capturedAt 的一条快照，避免同 SKU 多批次重复计。
 * - 库存状态分列：可售 fulfillable / 预留 reserved / 在途 inbound(working+shipped+receiving) /
 *   不可用 unfulfillable / 调研中 researching；各列原值求和，不推断、不补零。
 * - 库存健康分层（Wimoor planning 口径简化，保守默认）：
 *   可用=fulfillable；总库存=各状态之和；在途占比=inbound/总库存（总量 0 时为 null）；
 *   缺货风险=可售为 0 且在途为 0（有 SKU 记录），滞销信号=可售>0 且其他状态为 0（仅信号，非结论）。
 * - 按站点 + 币种无关（库存为数量非金额，不折算）；快照为采集时点，非历史每日库存。
 */

export type InventoryLineInput = {
  sellerSku: string;
  asin: string;
  marketplaceId: string;
  fulfillable: number;
  reserved: number;
  inbound: number;
  unfulfillable: number;
  researching: number;
};

export type InventoryHealthRow = {
  sellerSku: string;
  asin: string;
  marketplaceId: string;
  fulfillable: number;
  reserved: number;
  inbound: number;
  unfulfillable: number;
  researching: number;
  total: number;
  inboundRatio: string | null;
  riskFlag: "OUT_OF_STOCK_RISK" | "IDLE_SIGNAL" | "NORMAL";
};

export type InventoryHealthSummary = {
  skuCount: number;
  fulfillable: number;
  reserved: number;
  inbound: number;
  unfulfillable: number;
  researching: number;
  outOfStockRiskCount: number;
  idleSignalCount: number;
};

function fmt(n: number): string {
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** 纯函数：库存快照行 → SKU 健康透视行。 */
export function buildInventoryHealthRows(lines: InventoryLineInput[]): InventoryHealthRow[] {
  return lines.map(l => {
    const total = l.fulfillable + l.reserved + l.inbound + l.unfulfillable + l.researching;
    const inboundRatio = total > 0 ? fmt(l.inbound / total) : null;
    let riskFlag: InventoryHealthRow["riskFlag"] = "NORMAL";
    if (l.fulfillable === 0 && l.inbound === 0) riskFlag = "OUT_OF_STOCK_RISK";
    else if (l.fulfillable > 0 && l.reserved + l.inbound + l.unfulfillable + l.researching === 0) riskFlag = "IDLE_SIGNAL";
    return {
      sellerSku: l.sellerSku,
      asin: l.asin,
      marketplaceId: l.marketplaceId,
      fulfillable: l.fulfillable,
      reserved: l.reserved,
      inbound: l.inbound,
      unfulfillable: l.unfulfillable,
      researching: l.researching,
      total,
      inboundRatio,
      riskFlag,
    };
  }).sort((a, b) => a.marketplaceId.localeCompare(b.marketplaceId) || a.sellerSku.localeCompare(b.sellerSku));
}

/** 纯函数：健康行 → 汇总指标（总量 + 风险/滞销信号计数）。 */
export function buildInventoryHealthSummary(rows: InventoryHealthRow[]): InventoryHealthSummary {
  const sum = (key: "fulfillable" | "reserved" | "inbound" | "unfulfillable" | "researching") => rows.reduce((n, r) => n + r[key], 0);
  return {
    skuCount: rows.length,
    fulfillable: sum("fulfillable"),
    reserved: sum("reserved"),
    inbound: sum("inbound"),
    unfulfillable: sum("unfulfillable"),
    researching: sum("researching"),
    outOfStockRiskCount: rows.filter(r => r.riskFlag === "OUT_OF_STOCK_RISK").length,
    idleSignalCount: rows.filter(r => r.riskFlag === "IDLE_SIGNAL").length,
  };
}

export const INVENTORY_HEALTH_BASIS = [
  "FBA 库存健康透视口径（保守默认，迁移自 Wimoor FBA 库存 detail + planning）：",
  "1) 数据源仅 AmazonInventorySnapshot（SP-API FBA Inventory 真实快照），不接赛狐。",
  "2) 每个站点+SKU 取最近 capturedAt 一条快照，避免多批次重复计；快照为采集时点，非历史每日库存。",
  "3) 状态分列：可售/预留/在途(working+shipped+receiving)/不可用/调研中；总量为各状态之和，不推断。",
  "4) 健康分层：缺货风险=可售0且在途0；滞销信号=可售>0且其余状态为0（仅信号非结论）；其余正常。在途占比=在途/总量，总量0为null。",
  "5) 库存为数量非金额，不涉及折算；不补零、不估算。",
].join("\n");

const ROW_CAP = 12000;

/** 只读：每个站点+SKU 最新库存快照 → 健康透视 + 汇总。 */
export async function readInventoryHealth(scope: SyncScope, params: URLSearchParams, actor?: string): Promise<{
  rows: InventoryHealthRow[]; summary: InventoryHealthSummary; basis: string; asOf: string; truncated: boolean;
}> {
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "inventory");
  const sellerIds = access.allSellers ? [] : access.sellerIds;
  const skuFilter = params.get("sku")?.trim().slice(0, 200) ?? "";
  const asinFilter = params.get("asin")?.trim().slice(0, 200) ?? "";
  const marketplace = params.get("marketplaceId")?.trim().slice(0, 50) ?? "";

  // 先取最新快照（按 capturedAt desc），在应用层按 site+sku 去重（保留首条=最新）。
  const raw = await prisma.amazonInventorySnapshot.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
      ...(skuFilter ? { sellerSku: { contains: skuFilter } } : {}),
      ...(asinFilter ? { asin: { contains: asinFilter } } : {}),
      ...(marketplace ? { marketplaceId: marketplace } : {}),
    },
    select: {
      sellerSku: true, asin: true, marketplaceId: true,
      fulfillableQuantity: true, reservedQuantity: true,
      inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true,
      unfulfillableQuantity: true, researchingQuantity: true,
    },
    orderBy: { capturedAt: "desc" },
    take: ROW_CAP * 2 + 1,
  });

  const seen = new Set<string>();
  const lines: InventoryLineInput[] = [];
  for (const r of raw) {
    const sku = (r.sellerSku ?? "").trim();
    if (!sku) continue;
    const key = `${r.marketplaceId}\u0000${sku}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({
      sellerSku: sku,
      asin: r.asin ?? "",
      marketplaceId: r.marketplaceId,
      fulfillable: r.fulfillableQuantity,
      reserved: r.reservedQuantity,
      inbound: r.inboundWorkingQuantity + r.inboundShippedQuantity + r.inboundReceivingQuantity,
      unfulfillable: r.unfulfillableQuantity,
      researching: r.researchingQuantity,
    });
    if (lines.length >= ROW_CAP) break;
  }
  const rows = buildInventoryHealthRows(lines);
  return {
    rows,
    summary: buildInventoryHealthSummary(rows),
    basis: INVENTORY_HEALTH_BASIS,
    asOf: new Date().toISOString(),
    truncated: raw.length > ROW_CAP * 2,
  };
}
