import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sellerAccessWhere, type AmazonDataAccess } from "@/lib/amazon-sync/data-access";
import { amazonAccountReadAccess } from "@/lib/amazon-sync/read-account";
import { publishedSnapshotScopes, inventoryPublishedWhere } from "@/lib/amazon-sync/read";
import { inventorySnapshotStatus } from "@/lib/operations/readiness";
import { readProductImageReferences } from "@/lib/operations/amazon-product-images";
import { extractAmazonProductTitle } from "@/lib/amazon-sync/catalog-images";
import { sellfoxMarketplaceSites } from "@/lib/sellfox/marketplace-site";
import { SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";

/**
 * Amazon FBA 库存分组工作台只读数据层（参考赛狐 /sellfox/dimensions 的分组下钻范式）。
 *
 * 边界：
 * - 只关联 Amazon 自己的数据（AmazonSyncDataSource / AmazonInventorySnapshot /
 *   AmazonDomainObservation / AmazonOrderRecord+Item / 本地持久化主图），
 *   不与赛狐任何模型互通；站点字典复用 Amazon Marketplace ID 标准映射（非业务数据）。
 * - 组织 / 工作区双隔离；概览用 amazonDataAccess 拿可见店铺全集并收窄，
 *   下钻用 amazonAccountReadAccess 校验单账号，读权限与 /operations 完全一致。
 * - 销量是「订单口径累计件数」（AmazonOrderItemRecord.quantityOrdered 汇总），
 *   不是按日快照、不是店铺级 sales_traffic；页面必须显式标注，避免口径误读。
 * - 不臆造：标题/图片/销量缺失留空或 0 并标注来源，不回填、不估算。
 */

const INVENTORY_PAGE_CAP = 6000;
const ORDER_PAGE_CAP = 12000;
const OBSERVATION_PAGE_CAP = 4000;

export type SiteGroup = {
  marketplaceId: string; code: string; label: string;
  sellerCount: number; asinCount: number;
};
export type SellerGroup = {
  sellerAccountId: string; sellerName: string; marketplaceId: string; code: string; label: string;
  asinCount: number; skuCount: number;
  available: number; inbound: number; reserved: number; unfulfillable: number;
  snapshotCapturedAt: string | null; freshness: "FRESH" | "STALE" | "NOT_SYNCED";
};
export type AsinRow = {
  asin: string; sellerSku: string; title: string; imageFileId: string | null;
  available: number; inbound: number; reserved: number; unfulfillable: number;
  saleQuantity: number; orderCount: number;
};
export type InventoryOverview = {
  sites: SiteGroup[]; sellers: SellerGroup[];
  coverage: { sites: number; sellers: number; asins: number; inventoryRows: number; truncated: boolean };
};
export type SellerAsinResult = {
  sellerAccountId: string; marketplaceId: string;
  asins: AsinRow[];
  snapshotCapturedAt: string | null;
  coverage: { asins: number; inventoryRows: number; orderRows: number; truncated: boolean };
  salesBasis: string;
};

function siteMeta(marketplaceId: string) {
  const found = sellfoxMarketplaceSites[marketplaceId];
  return { code: found?.code ?? marketplaceId, label: found?.label ?? marketplaceId };
}

export type OverviewSourceRow = {
  sellerAccountId: string; marketplaceId: string; sellerName: string;
  capturedAt: Date | null; freshnessMinutes: number;
};
export type OverviewInventoryRow = {
  sellerAccountId: string; marketplaceId: string; asin: string; sellerSku: string;
  fulfillableQuantity: number; inboundWorkingQuantity: number; inboundShippedQuantity: number;
  inboundReceivingQuantity: number; reservedQuantity: number; unfulfillableQuantity: number;
};

/** 纯函数：由已发布库存数据源 + 库存聚合行派生站点/店铺分组，便于单测。 */
export function buildInventoryOverview(sources: OverviewSourceRow[], inventoryRows: OverviewInventoryRow[], truncated = false): InventoryOverview {
  const agg = new Map<string, { asins: Set<string>; skus: Set<string>; available: number; inbound: number; reserved: number; unfulfillable: number }>();
  for (const row of inventoryRows) {
    const key = `${row.sellerAccountId}::${row.marketplaceId}`;
    let a = agg.get(key);
    if (!a) { a = { asins: new Set(), skus: new Set(), available: 0, inbound: 0, reserved: 0, unfulfillable: 0 }; agg.set(key, a); }
    if (row.asin) a.asins.add(row.asin);
    if (row.sellerSku) a.skus.add(row.sellerSku);
    a.available += row.fulfillableQuantity ?? 0;
    a.inbound += (row.inboundWorkingQuantity ?? 0) + (row.inboundShippedQuantity ?? 0) + (row.inboundReceivingQuantity ?? 0);
    a.reserved += row.reservedQuantity ?? 0;
    a.unfulfillable += row.unfulfillableQuantity ?? 0;
  }
  const sellers: SellerGroup[] = sources.map((s) => {
    const meta = siteMeta(s.marketplaceId);
    const a = agg.get(`${s.sellerAccountId}::${s.marketplaceId}`);
    const freshness = s.capturedAt ? inventorySnapshotStatus(s.capturedAt, new Date(), s.freshnessMinutes) : "NOT_SYNCED";
    return {
      sellerAccountId: s.sellerAccountId, sellerName: s.sellerName, marketplaceId: s.marketplaceId,
      code: meta.code, label: meta.label,
      asinCount: a?.asins.size ?? 0, skuCount: a?.skus.size ?? 0,
      available: a?.available ?? 0, inbound: a?.inbound ?? 0, reserved: a?.reserved ?? 0, unfulfillable: a?.unfulfillable ?? 0,
      snapshotCapturedAt: s.capturedAt ? s.capturedAt.toISOString() : null,
      freshness,
    };
  }).sort((a, b) => a.code.localeCompare(b.code) || a.sellerName.localeCompare(b.sellerName));

  const siteMap = new Map<string, SiteGroup>();
  for (const s of sellers) {
    let g = siteMap.get(s.marketplaceId);
    if (!g) {
      const meta = siteMeta(s.marketplaceId);
      g = { marketplaceId: s.marketplaceId, code: meta.code, label: meta.label, sellerCount: 0, asinCount: 0 };
      siteMap.set(s.marketplaceId, g);
    }
    g.sellerCount += 1;
    g.asinCount += s.asinCount;
  }
  const sites = [...siteMap.values()].sort((a, b) => b.sellerCount - a.sellerCount || a.code.localeCompare(b.code));
  return {
    sites, sellers,
    coverage: {
      sites: sites.length, sellers: sellers.length,
      asins: sellers.reduce((n, s) => n + s.asinCount, 0),
      inventoryRows: inventoryRows.length, truncated,
    },
  };
}

export async function readInventoryWorkbenchOverview(scope: SyncScope, actor?: string): Promise<InventoryOverview> {
  const access: AmazonDataAccess = await amazonDataAccess(scope, actor, prisma, "view");
  const allowed = sellerAccessWhere(access);
  const sourceRows = await prisma.amazonSyncDataSource.findMany({
    where: {
      ...scope, ...allowed, resource: "inventory", enabled: true, activeRunId: { not: null },
      publishedRun: { status: "SUCCEEDED", executionVersion: 2, finishedAt: { not: null }, stage: { not: "PURGED" } },
    },
    select: {
      sellerAccountId: true, marketplaceId: true, activeRunId: true, lastSuccessAt: true, freshnessMinutes: true,
      seller: { select: { displayName: true, accountKey: true } },
    },
    orderBy: [{ marketplaceId: "asc" }, { sellerAccountId: "asc" }],
    take: 201,
  });
  if (sourceRows.length > 200) throw new SyncInputError("库存数据源超过试点容量，需要先完成容量评审。", 409);
  if (!sourceRows.length) return buildInventoryOverview([], [], false);

  const sources: OverviewSourceRow[] = sourceRows.map((s) => ({
    sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId,
    sellerName: s.seller.displayName || s.seller.accountKey || s.sellerAccountId,
    capturedAt: s.lastSuccessAt, freshnessMinutes: s.freshnessMinutes,
  }));
  const heads = sourceRows.map((s) => ({
    runId: s.activeRunId!, sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId,
    capturedAt: s.lastSuccessAt, freshnessMinutes: s.freshnessMinutes,
  }));
  const inventoryRows = await prisma.amazonInventorySnapshot.findMany({
    where: inventoryPublishedWhere(scope, heads),
    select: {
      sellerAccountId: true, marketplaceId: true, asin: true, sellerSku: true,
      fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true,
      inboundReceivingQuantity: true, reservedQuantity: true, unfulfillableQuantity: true,
    },
    take: INVENTORY_PAGE_CAP + 1,
  });
  const truncated = inventoryRows.length > INVENTORY_PAGE_CAP;
  const validRows: OverviewInventoryRow[] = inventoryRows.slice(0, INVENTORY_PAGE_CAP)
    .filter((r): r is OverviewInventoryRow & { sellerAccountId: string } => r.sellerAccountId != null);
  return buildInventoryOverview(sources, validRows, truncated);
}

export type AsinInventoryRow = {
  asin: string; sellerSku: string;
  fulfillableQuantity: number; inboundWorkingQuantity: number; inboundShippedQuantity: number;
  inboundReceivingQuantity: number; reservedQuantity: number; unfulfillableQuantity: number;
};
export type AsinTitleRow = { asin: string; title: string | null; preferred: boolean };
export type AsinImageRow = { asin: string; fileId: string };
export type AsinOrderRow = { asin: string; orderCount: number; saleQuantity: number };

/** 纯函数：库存按 ASIN 收敛（跨 SKU/状况累加），并合并标题/图片/订单口径销量。 */
export function buildSellerAsins(
  inventoryRows: AsinInventoryRow[],
  titleRows: AsinTitleRow[],
  imageRows: AsinImageRow[],
  orderRows: AsinOrderRow[],
): AsinRow[] {
  const titleByAsin = new Map<string, string>();
  for (const t of titleRows) {
    const title = (t.title ?? "").trim();
    if (!title) continue;
    const prev = titleByAsin.get(t.asin);
    if (!prev || t.preferred) titleByAsin.set(t.asin, title);
  }
  const imageByAsin = new Map(imageRows.map((i) => [i.asin, i.fileId]));
  const orderByAsin = new Map(orderRows.map((o) => [o.asin, o]));
  const rows = new Map<string, AsinRow>();
  for (const inv of inventoryRows) {
    const asin = (inv.asin ?? "").trim();
    if (!asin) continue;
    let row = rows.get(asin);
    if (!row) {
      const order = orderByAsin.get(asin);
      row = {
        asin, sellerSku: (inv.sellerSku ?? "").trim(), title: titleByAsin.get(asin) ?? "",
        imageFileId: imageByAsin.get(asin) ?? null,
        available: 0, inbound: 0, reserved: 0, unfulfillable: 0,
        saleQuantity: order?.saleQuantity ?? 0, orderCount: order?.orderCount ?? 0,
      };
      rows.set(asin, row);
    }
    row.available += inv.fulfillableQuantity ?? 0;
    row.inbound += (inv.inboundWorkingQuantity ?? 0) + (inv.inboundShippedQuantity ?? 0) + (inv.inboundReceivingQuantity ?? 0);
    row.reserved += inv.reservedQuantity ?? 0;
    row.unfulfillable += inv.unfulfillableQuantity ?? 0;
  }
  // 只在订单里出现、库存快照未收录的 ASIN 不补行进：本页是库存工作台，库存是骨架。
  return [...rows.values()].sort((a, b) => b.available - a.available || a.asin.localeCompare(b.asin));
}

export async function readSellerAsins(scope: SyncScope, actor: string | undefined, sellerAccountId: string, marketplaceId: string): Promise<SellerAsinResult> {
  sellerAccountId = (sellerAccountId ?? "").trim();
  marketplaceId = (marketplaceId ?? "").trim();
  if (!sellerAccountId || !marketplaceId) throw new SyncInputError("缺少店铺或站点参数。", 400);
  // 与 /operations 业务读同一账号校验：单账号、来源配置、官方授权状态。
  const access = await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sellerAccountId, marketplaceId }), prisma, "inventory");
  const target = { sellerAccountId: access.sellerIds[0], marketplaceId };
  const heads = await publishedSnapshotScopes(scope, "inventory", actor, target);
  const capturedAt = heads.length ? new Date(Math.min(...heads.map((h) => h.capturedAt?.getTime() ?? Infinity))) : null;

  const inventoryRows = heads.length ? await prisma.amazonInventorySnapshot.findMany({
    where: inventoryPublishedWhere(scope, heads),
    select: {
      asin: true, sellerSku: true,
      fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true,
      inboundReceivingQuantity: true, reservedQuantity: true, unfulfillableQuantity: true,
    },
    take: INVENTORY_PAGE_CAP + 1,
  }) : [];
  const truncated = inventoryRows.length > INVENTORY_PAGE_CAP;
  const capped = inventoryRows.slice(0, INVENTORY_PAGE_CAP);
  const asins = [...new Set(capped.map((r) => r.asin).filter((a) => a && a.trim()))];
  if (!asins.length) {
    return { sellerAccountId: target.sellerAccountId, marketplaceId, asins: [], snapshotCapturedAt: capturedAt?.toISOString() ?? null, coverage: { asins: 0, inventoryRows: capped.length, orderRows: 0, truncated }, salesBasis: SALES_BASIS };
  }

  const [titleRows, imageRows, orderRows] = await Promise.all([
    readTitles(scope, target, asins),
    readProductImageReferences(scope, asins.map((asin) => ({ sellerAccountId: target.sellerAccountId, marketplaceId, asin }))),
    readOrderQuantities(scope, target, asins),
  ]);

  return {
    sellerAccountId: target.sellerAccountId, marketplaceId,
    asins: buildSellerAsins(capped, titleRows, imageRows.map((i) => ({ asin: i.asin, fileId: i.fileId })), orderRows),
    snapshotCapturedAt: capturedAt && Number.isFinite(capturedAt.getTime()) ? capturedAt.toISOString() : null,
    coverage: { asins: asins.length, inventoryRows: capped.length, orderRows: orderRows.length, truncated },
    salesBasis: SALES_BASIS,
  };
}

export const SALES_BASIS = "销量为订单商品表按 ASIN 汇总的累计件数（按订单口径），不是按日销量快照，也不等于店铺级销售流量；下单时间与库存快照时间可能不同步。";

async function readTitles(scope: SyncScope, target: { sellerAccountId: string; marketplaceId: string }, asins: string[]): Promise<AsinTitleRow[]> {
  const sources = await prisma.amazonSyncDataSource.findMany({
    where: {
      ...scope, sellerAccountId: target.sellerAccountId, marketplaceId: target.marketplaceId,
      resource: { in: ["catalog_items", "listing_details"] }, enabled: true, activeRunId: { not: null },
      publishedRun: { status: "SUCCEEDED", executionVersion: 2, finishedAt: { not: null }, stage: { not: "PURGED" } },
    },
    select: { id: true, resource: true, activeRunId: true },
    take: 50,
  });
  if (!sources.length) return [];
  const observations = await prisma.amazonDomainObservation.findMany({
    where: {
      ...scope,
      OR: sources.map((s) => ({ sourceId: s.id, sourceRunId: s.activeRunId! })),
      asin: { in: asins }, kind: { in: ["CATALOG_DETAIL", "LISTING_DETAIL"] },
    },
    select: { sourceId: true, asin: true, facts: true },
    take: OBSERVATION_PAGE_CAP,
  });
  const preferredSources = new Set(sources.filter((s) => s.resource === "catalog_items").map((s) => s.id));
  return observations.map((o) => ({
    asin: o.asin ?? "",
    title: o.asin ? extractAmazonProductTitle(o.facts, target.marketplaceId) : null,
    preferred: preferredSources.has(o.sourceId),
  })).filter((r) => r.asin);
}

async function readOrderQuantities(scope: SyncScope, target: { sellerAccountId: string; marketplaceId: string }, asins: string[]): Promise<AsinOrderRow[]> {
  const rows = await prisma.$queryRaw<Array<{ asin: string; orderCount: bigint; saleQuantity: bigint }>>(Prisma.sql`
    SELECT oi.asin AS asin, count(*)::bigint AS "orderCount", COALESCE(sum(oi."quantityOrdered"), 0)::bigint AS "saleQuantity"
    FROM "AmazonOrderItemRecord" oi
    JOIN "AmazonOrderRecord" o ON o."organizationId"=oi."organizationId" AND o."workspaceId"=oi."workspaceId" AND o."sourceId"=oi."sourceId" AND o.id=oi."orderRecordId"
    JOIN "AmazonSyncRun" t ON t.id=o."sourceRunId" AND t."organizationId"=o."organizationId" AND t."workspaceId"=o."workspaceId" AND t."sourceId"=o."sourceId"
    WHERE oi."organizationId"=${scope.organizationId} AND oi."workspaceId"=${scope.workspaceId}
      AND o."sellerAccountId"=${target.sellerAccountId} AND o."marketplaceId"=${target.marketplaceId}
      AND t.status='SUCCEEDED' AND t."executionVersion"=2 AND t.stage <> 'PURGED'
      AND length(trim(oi.asin)) > 0 AND oi.asin IN (${Prisma.join(asins)})
    GROUP BY oi.asin
    ORDER BY "saleQuantity" DESC
    LIMIT ${ORDER_PAGE_CAP}
  `);
  return rows.map((r) => ({ asin: r.asin, orderCount: Number(r.orderCount), saleQuantity: Number(r.saleQuantity) }));
}
