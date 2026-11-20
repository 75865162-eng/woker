import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sellerAccessWhere, type AmazonDataAccess } from "@/lib/amazon-sync/data-access";
import { amazonAccountReadAccess } from "@/lib/amazon-sync/read-account";
import { publishedSnapshotScopes, catalogPublishedWhere, inventoryPublishedWhere } from "@/lib/amazon-sync/read";
import { inventorySnapshotStatus } from "@/lib/operations/readiness";
import { readProductImageReferences } from "@/lib/operations/amazon-product-images";
import { extractAmazonProductTitle } from "@/lib/amazon-sync/catalog-images";
import { sellfoxMarketplaceSites } from "@/lib/sellfox/marketplace-site";
import { SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";

/**
 * Amazon 在线商品与库存分组工作台只读数据层（参考赛狐 /sellfox/dimensions 分组下钻范式）。
 *
 * 与 FBA 库存页（inventory-workbench）的差异：
 * - 骨架用「在线商品」已发布快照 AmazonCatalogSnapshot，它是 SKU 级（sellerSku 为主，asin 可空），
 *   因此分组计数以 SKU 为准，下钻面板按 SKU 粒度展示在线商品。
 * - 标题/主图来自 catalog_items / listing_details 观察 + 本地持久化主图；
 *   库存四列按 SKU 关联 AmazonInventorySnapshot（与 /operations 在线商品口径一致）。
 * - 销量是「订单商品表按 sellerSku 汇总的累计件数（按订单口径）」，不是按日快照、不是店铺级 sales_traffic；
 *   按 SKU 聚合避免同一 ASIN 多 SKU 时重复计数；页面必须显式标注口径。
 * - 组织 / 工作区双隔离；概览用 amazonDataAccess 收窄可见店铺全集，下钻用 amazonAccountReadAccess 校验单账号。
 * - 不臆造：标题/图片/销量缺失留空或 0 并标注来源，不回填、不估算。
 */

const CATALOG_PAGE_CAP = 6000;
const INVENTORY_PAGE_CAP = 6000;
const ORDER_PAGE_CAP = 12000;
const OBSERVATION_PAGE_CAP = 4000;

export type SiteGroup = {
  marketplaceId: string; code: string; label: string;
  sellerCount: number; skuCount: number; asinCount: number;
};
export type SellerGroup = {
  sellerAccountId: string; sellerName: string; marketplaceId: string; code: string; label: string;
  skuCount: number; asinCount: number;
  snapshotCapturedAt: string | null; freshness: "FRESH" | "STALE" | "NOT_SYNCED";
};
export type CatalogItemRow = {
  sellerSku: string; asin: string; title: string; imageFileId: string | null;
  listingStatus: string | null; fulfillmentType: string | null;
  available: number | null; inbound: number | null; reserved: number | null; unfulfillable: number | null;
  saleQuantity: number; orderCount: number;
};
export type CatalogOverview = {
  sites: SiteGroup[]; sellers: SellerGroup[];
  coverage: { sites: number; sellers: number; skus: number; asins: number; catalogRows: number; truncated: boolean };
};
export type SellerCatalogResult = {
  sellerAccountId: string; marketplaceId: string;
  items: CatalogItemRow[];
  snapshotCapturedAt: string | null;
  coverage: { skus: number; catalogRows: number; inventoryRows: number; orderRows: number; truncated: boolean };
  salesBasis: string;
};

export const SALES_BASIS = "销量为订单商品表按 Seller SKU 汇总的累计件数（按订单口径），不是按日销量快照，也不等于店铺级销售流量；下单时间与在线商品快照时间可能不同步。";

function siteMeta(marketplaceId: string) {
  const found = sellfoxMarketplaceSites[marketplaceId];
  return { code: found?.code ?? marketplaceId, label: found?.label ?? marketplaceId };
}

export type OverviewSourceRow = {
  sellerAccountId: string; marketplaceId: string; sellerName: string;
  capturedAt: Date | null; freshnessMinutes: number;
};
export type OverviewCatalogRow = {
  sellerAccountId: string; marketplaceId: string; asin: string; sellerSku: string;
};

/** 纯函数：已发布在线商品数据源 + catalog 快照行 → 站点/店铺分组，便于单测。 */
export function buildCatalogOverview(sources: OverviewSourceRow[], catalogRows: OverviewCatalogRow[], truncated = false): CatalogOverview {
  const agg = new Map<string, { skus: Set<string>; asins: Set<string> }>();
  for (const row of catalogRows) {
    const key = `${row.sellerAccountId}::${row.marketplaceId}`;
    let a = agg.get(key);
    if (!a) { a = { skus: new Set(), asins: new Set() }; agg.set(key, a); }
    const sku = (row.sellerSku ?? "").trim();
    const asin = (row.asin ?? "").trim();
    if (sku) a.skus.add(sku);
    if (asin) a.asins.add(asin);
  }
  const sellers: SellerGroup[] = sources.map((s) => {
    const meta = siteMeta(s.marketplaceId);
    const a = agg.get(`${s.sellerAccountId}::${s.marketplaceId}`);
    const freshness = s.capturedAt ? inventorySnapshotStatus(s.capturedAt, new Date(), s.freshnessMinutes) : "NOT_SYNCED";
    return {
      sellerAccountId: s.sellerAccountId, sellerName: s.sellerName, marketplaceId: s.marketplaceId,
      code: meta.code, label: meta.label,
      skuCount: a?.skus.size ?? 0, asinCount: a?.asins.size ?? 0,
      snapshotCapturedAt: s.capturedAt ? s.capturedAt.toISOString() : null,
      freshness,
    };
  }).sort((a, b) => a.code.localeCompare(b.code) || a.sellerName.localeCompare(b.sellerName));

  const siteMap = new Map<string, SiteGroup>();
  for (const s of sellers) {
    let g = siteMap.get(s.marketplaceId);
    if (!g) {
      const meta = siteMeta(s.marketplaceId);
      g = { marketplaceId: s.marketplaceId, code: meta.code, label: meta.label, sellerCount: 0, skuCount: 0, asinCount: 0 };
      siteMap.set(s.marketplaceId, g);
    }
    g.sellerCount += 1;
    g.skuCount += s.skuCount;
    g.asinCount += s.asinCount;
  }
  const sites = [...siteMap.values()].sort((a, b) => b.sellerCount - a.sellerCount || a.code.localeCompare(b.code));
  return {
    sites, sellers,
    coverage: {
      sites: sites.length, sellers: sellers.length,
      skus: sellers.reduce((n, s) => n + s.skuCount, 0),
      asins: sellers.reduce((n, s) => n + s.asinCount, 0),
      catalogRows: catalogRows.length, truncated,
    },
  };
}

export async function readCatalogWorkbenchOverview(scope: SyncScope, actor?: string): Promise<CatalogOverview> {
  const access: AmazonDataAccess = await amazonDataAccess(scope, actor, prisma, "view");
  const allowed = sellerAccessWhere(access);
  const sourceRows = await prisma.amazonSyncDataSource.findMany({
    where: {
      ...scope, ...allowed, resource: "catalog", enabled: true, activeRunId: { not: null },
      publishedRun: { status: "SUCCEEDED", executionVersion: 2, finishedAt: { not: null }, stage: { not: "PURGED" } },
    },
    select: {
      sellerAccountId: true, marketplaceId: true, activeRunId: true, lastSuccessAt: true, freshnessMinutes: true,
      seller: { select: { displayName: true, accountKey: true } },
    },
    orderBy: [{ marketplaceId: "asc" }, { sellerAccountId: "asc" }],
    take: 201,
  });
  if (sourceRows.length > 200) throw new SyncInputError("在线商品数据源超过试点容量，需要先完成容量评审。", 409);
  if (!sourceRows.length) return buildCatalogOverview([], [], false);

  const sources: OverviewSourceRow[] = sourceRows.map((s) => ({
    sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId,
    sellerName: s.seller.displayName || s.seller.accountKey || s.sellerAccountId,
    capturedAt: s.lastSuccessAt, freshnessMinutes: s.freshnessMinutes,
  }));
  const heads = sourceRows.map((s) => ({
    runId: s.activeRunId!, sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId,
    capturedAt: s.lastSuccessAt, freshnessMinutes: s.freshnessMinutes,
  }));
  const catalogRows = await prisma.amazonCatalogSnapshot.findMany({
    where: catalogPublishedWhere(scope, heads),
    select: { sellerAccountId: true, marketplaceId: true, asin: true, sellerSku: true },
    take: CATALOG_PAGE_CAP + 1,
  });
  const truncated = catalogRows.length > CATALOG_PAGE_CAP;
  const validRows: OverviewCatalogRow[] = catalogRows.slice(0, CATALOG_PAGE_CAP);
  return buildCatalogOverview(sources, validRows, truncated);
}

export type AsinCatalogRow = { sellerSku: string; asin: string; listingStatus: string | null; fulfillmentType: string | null };
export type AsinInventoryRow = {
  sellerSku: string; fulfillableQuantity: number; inboundWorkingQuantity: number; inboundShippedQuantity: number;
  inboundReceivingQuantity: number; reservedQuantity: number; unfulfillableQuantity: number;
};
export type AsinTitleRow = { asin: string; title: string | null; preferred: boolean };
export type AsinImageRow = { asin: string; fileId: string };
export type SkuOrderRow = { sellerSku: string; orderCount: number; saleQuantity: number };

/** 纯函数：在线商品 SKU 行收敛 + 标题/图片/库存/订单口径销量合并。库存与销量缺失留 null/0，不补零臆造。 */
export function buildSellerCatalogItems(
  catalogRows: AsinCatalogRow[],
  inventoryRows: AsinInventoryRow[],
  titleRows: AsinTitleRow[],
  imageRows: AsinImageRow[],
  orderRows: SkuOrderRow[],
): CatalogItemRow[] {
  const titleByAsin = new Map<string, string>();
  for (const t of titleRows) {
    const title = (t.title ?? "").trim();
    if (!title) continue;
    const prev = titleByAsin.get(t.asin);
    if (!prev || t.preferred) titleByAsin.set(t.asin, title);
  }
  const imageByAsin = new Map(imageRows.map((i) => [i.asin, i.fileId]));
  const invBySku = new Map(inventoryRows.map((r) => [r.sellerSku, r]));
  const orderBySku = new Map(orderRows.map((o) => [o.sellerSku, o]));
  const rows = new Map<string, CatalogItemRow>();
  for (const c of catalogRows) {
    const sku = (c.sellerSku ?? "").trim();
    if (!sku) continue;
    if (rows.has(sku)) continue;
    const asin = (c.asin ?? "").trim();
    const inv = invBySku.get(sku);
    const order = orderBySku.get(sku);
    rows.set(sku, {
      sellerSku: sku, asin, title: asin ? titleByAsin.get(asin) ?? "" : "",
      imageFileId: asin ? imageByAsin.get(asin) ?? null : null,
      listingStatus: c.listingStatus ?? null, fulfillmentType: c.fulfillmentType ?? null,
      available: inv ? inv.fulfillableQuantity : null,
      inbound: inv ? inv.inboundWorkingQuantity + inv.inboundShippedQuantity + inv.inboundReceivingQuantity : null,
      reserved: inv ? inv.reservedQuantity : null,
      unfulfillable: inv ? inv.unfulfillableQuantity : null,
      saleQuantity: order?.saleQuantity ?? 0, orderCount: order?.orderCount ?? 0,
    });
  }
  return [...rows.values()].sort((a, b) => b.saleQuantity - a.saleQuantity || a.sellerSku.localeCompare(b.sellerSku));
}

export async function readSellerCatalogItems(scope: SyncScope, actor: string | undefined, sellerAccountId: string, marketplaceId: string): Promise<SellerCatalogResult> {
  sellerAccountId = (sellerAccountId ?? "").trim();
  marketplaceId = (marketplaceId ?? "").trim();
  if (!sellerAccountId || !marketplaceId) throw new SyncInputError("缺少店铺或站点参数。", 400);
  const access = await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sellerAccountId, marketplaceId }), prisma, "catalog");
  const target = { sellerAccountId: access.sellerIds[0], marketplaceId };
  const [catalogHeads, inventoryHeads] = await Promise.all([
    publishedSnapshotScopes(scope, "catalog", actor, target),
    publishedSnapshotScopes(scope, "inventory", actor, target),
  ]);
  const catalogCapturedAt = catalogHeads.length ? new Date(Math.min(...catalogHeads.map((h) => h.capturedAt?.getTime() ?? Infinity))) : null;

  const catalogRows = catalogHeads.length ? await prisma.amazonCatalogSnapshot.findMany({
    where: catalogPublishedWhere(scope, catalogHeads),
    select: { sellerSku: true, asin: true, listingStatus: true, fulfillmentType: true },
    take: CATALOG_PAGE_CAP + 1,
  }) : [];
  const truncated = catalogRows.length > CATALOG_PAGE_CAP;
  const capped = catalogRows.slice(0, CATALOG_PAGE_CAP);
  const skus = [...new Set(capped.map((r) => (r.sellerSku ?? "").trim()).filter(Boolean))];
  const asins = [...new Set(capped.map((r) => (r.asin ?? "").trim()).filter(Boolean))];
  if (!skus.length) {
    return { sellerAccountId: target.sellerAccountId, marketplaceId, items: [], snapshotCapturedAt: catalogCapturedAt && Number.isFinite(catalogCapturedAt.getTime()) ? catalogCapturedAt.toISOString() : null, coverage: { skus: 0, catalogRows: capped.length, inventoryRows: 0, orderRows: 0, truncated }, salesBasis: SALES_BASIS };
  }

  const inventoryRows = inventoryHeads.length ? await prisma.amazonInventorySnapshot.findMany({
    where: inventoryPublishedWhere(scope, inventoryHeads),
    select: {
      sellerSku: true, fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true,
      inboundReceivingQuantity: true, reservedQuantity: true, unfulfillableQuantity: true,
    },
    take: INVENTORY_PAGE_CAP + 1,
  }) : [];
  const invCapped = inventoryRows.slice(0, INVENTORY_PAGE_CAP);

  const [titleRows, imageRows, orderRows] = await Promise.all([
    readTitles(scope, target, asins),
    asins.length ? readProductImageReferences(scope, asins.map((asin) => ({ sellerAccountId: target.sellerAccountId, marketplaceId, asin }))) : Promise.resolve([]),
    readSkuOrderQuantities(scope, target, skus),
  ]);

  const items = buildSellerCatalogItems(
    capped, invCapped, titleRows,
    imageRows.map((i) => ({ asin: i.asin, fileId: i.fileId })),
    orderRows,
  );
  return {
    sellerAccountId: target.sellerAccountId, marketplaceId, items,
    snapshotCapturedAt: catalogCapturedAt && Number.isFinite(catalogCapturedAt.getTime()) ? catalogCapturedAt.toISOString() : null,
    coverage: { skus: skus.length, catalogRows: capped.length, inventoryRows: invCapped.length, orderRows: orderRows.length, truncated },
    salesBasis: SALES_BASIS,
  };
}

async function readTitles(scope: SyncScope, target: { sellerAccountId: string; marketplaceId: string }, asins: string[]): Promise<AsinTitleRow[]> {
  if (!asins.length) return [];
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

async function readSkuOrderQuantities(scope: SyncScope, target: { sellerAccountId: string; marketplaceId: string }, skus: string[]): Promise<SkuOrderRow[]> {
  const rows = await prisma.$queryRaw<Array<{ sellerSku: string; orderCount: bigint; saleQuantity: bigint }>>(Prisma.sql`
    SELECT oi."sellerSku" AS "sellerSku", count(*)::bigint AS "orderCount", COALESCE(sum(oi."quantityOrdered"), 0)::bigint AS "saleQuantity"
    FROM "AmazonOrderItemRecord" oi
    JOIN "AmazonOrderRecord" o ON o."organizationId"=oi."organizationId" AND o."workspaceId"=oi."workspaceId" AND o."sourceId"=oi."sourceId" AND o.id=oi."orderRecordId"
    JOIN "AmazonSyncRun" t ON t.id=o."sourceRunId" AND t."organizationId"=o."organizationId" AND t."workspaceId"=o."workspaceId" AND t."sourceId"=o."sourceId"
    WHERE oi."organizationId"=${scope.organizationId} AND oi."workspaceId"=${scope.workspaceId}
      AND o."sellerAccountId"=${target.sellerAccountId} AND o."marketplaceId"=${target.marketplaceId}
      AND t.status='SUCCEEDED' AND t."executionVersion"=2 AND t.stage <> 'PURGED'
      AND length(trim(oi."sellerSku")) > 0 AND oi."sellerSku" IN (${Prisma.join(skus)})
    GROUP BY oi."sellerSku"
    ORDER BY "saleQuantity" DESC
    LIMIT ${ORDER_PAGE_CAP}
  `);
  return rows.map((r) => ({ sellerSku: r.sellerSku, orderCount: Number(r.orderCount), saleQuantity: Number(r.saleQuantity) }));
}
