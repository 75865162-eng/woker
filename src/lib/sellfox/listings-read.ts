import { Prisma } from "@prisma/client";
import { sellfoxAgentColumns } from "./agent-read";
import { SellfoxBrowseError, sellfoxExportLimit, type SellfoxBrowseQuery } from "./browse-query";
import { sellfoxSortKey, sellfoxSqlOrder } from "./browse-sort";

const projectedColumns = ["dxmPublishState", "fulfillment", "brand", "amazonBrand", "rating", "ratingCount", "productTags", "openDate", "firstSaleDate", "bsrRank", "bsrCategory", "purchaseCost", "fbaFees", "referralFee", "totalFee", "headTripCost", "buyBoxWinner", "reservedQty", "shippingPrice", "profitPrice", "profitRate", "listingQuantity", "unsellable", "warehousing"];
type Scope = { organizationId: string; workspaceId: string };

/** Listing current already joins Store and the last complete Head. Never rejoin its payload. */
export function listingsReadSql(query: SellfoxBrowseQuery, scope: Scope, exporting = false) {
  const scopeFilters = [Prisma.sql`s."organizationId"=${scope.organizationId} AND s."workspaceId"=${scope.workspaceId}`];
  if (query.shopExternalIds.length) scopeFilters.push(Prisma.sql`s."shopExternalId" IN (${Prisma.join(query.shopExternalIds)})`);
  if (query.storeId) scopeFilters.push(Prisma.sql`s."storeId"=${query.storeId}`);
  if (query.site) scopeFilters.push(Prisma.sql`s.marketplace=${query.site}`);
  const filters = [...scopeFilters];
  if (query.currency) filters.push(Prisma.sql`s.currency=${query.currency}`);
  if (query.status) filters.push(Prisma.sql`s.status ILIKE ${query.status}`);
  if (query.fulfillment) filters.push(Prisma.sql`s.fulfillment=${query.fulfillment}`);
  if (query.buyBox) filters.push(Prisma.sql`s."buyBoxWinner"=${query.buyBox === "yes" ? "是" : "否"}`);
  if (query.brand) filters.push(Prisma.sql`s.brand=${query.brand}`);
  if (query.bsrCategory) filters.push(Prisma.sql`s."bsrCategory"=${query.bsrCategory}`);
  if (query.productTag) filters.push(Prisma.sql`s."productTagNames" @> ARRAY[${query.productTag}]::text[]`);
  if (query.from) filters.push(Prisma.sql`s."openDate">=${query.from}`);
  if (query.to) filters.push(Prisma.sql`s."openDate"<=${query.to}`);
  if (query.firstSaleFrom) filters.push(Prisma.sql`s."firstSaleDate">=${query.firstSaleFrom}`);
  if (query.firstSaleTo) filters.push(Prisma.sql`s."firstSaleDate"<=${query.firstSaleTo}`);
  if (query.dxmPublishState) filters.push(Prisma.sql`s."dxmPublishState"=${query.dxmPublishState}`);
  if (query.totalInventoryMin != null || query.totalInventoryMax != null) {
    const bounds = [Prisma.sql`stock.inv IS NOT NULL`];
    if (query.totalInventoryMin != null) bounds.push(Prisma.sql`stock.inv>=${query.totalInventoryMin}`);
    if (query.totalInventoryMax != null) bounds.push(Prisma.sql`stock.inv<=${query.totalInventoryMax}`);
    // Match workbench enrichment: storeId+msku sum only when every warehouse row has non-NULL totalInventory.
    filters.push(Prisma.sql`EXISTS (SELECT 1 FROM (SELECT CASE WHEN count(i."totalInventory")=count(*) THEN sum(i."totalInventory") END AS inv FROM sellfox_inventory_current i WHERE i."organizationId"=s."organizationId" AND i."workspaceId"=s."workspaceId" AND i."storeId"=s."storeId" AND i.msku=s.msku GROUP BY i."storeId", i.msku) stock WHERE ${Prisma.join(bounds, " AND ")})`);
  }
  // Typed fulfillable (Int?; listing_current; not inventory enrich on listings); NULL excluded when either bound is set.
  if (query.fulfillableMin != null || query.fulfillableMax != null) {
    filters.push(Prisma.sql`s."fulfillable" IS NOT NULL`);
    if (query.fulfillableMin != null) filters.push(Prisma.sql`s."fulfillable">=${query.fulfillableMin}`);
    if (query.fulfillableMax != null) filters.push(Prisma.sql`s."fulfillable"<=${query.fulfillableMax}`);
  }
  // Typed bsrRank; NULL excluded when either bound is set (comparisons never match NULL).
  if (query.bsrRankMin != null || query.bsrRankMax != null) {
    filters.push(Prisma.sql`s."bsrRank" IS NOT NULL`);
    if (query.bsrRankMin != null) filters.push(Prisma.sql`s."bsrRank">=${query.bsrRankMin}`);
    if (query.bsrRankMax != null) filters.push(Prisma.sql`s."bsrRank"<=${query.bsrRankMax}`);
  }
  // Typed price (Float?); NULL excluded when either bound is set.
  if (query.priceMin != null || query.priceMax != null) {
    filters.push(Prisma.sql`s.price IS NOT NULL`);
    if (query.priceMin != null) filters.push(Prisma.sql`s.price>=${query.priceMin}`);
    if (query.priceMax != null) filters.push(Prisma.sql`s.price<=${query.priceMax}`);
  }
  // Typed sales7 (Int? window); NULL excluded when either bound is set.
  if (query.sales7Min != null || query.sales7Max != null) {
    filters.push(Prisma.sql`s."sales7" IS NOT NULL`);
    if (query.sales7Min != null) filters.push(Prisma.sql`s."sales7">=${query.sales7Min}`);
    if (query.sales7Max != null) filters.push(Prisma.sql`s."sales7"<=${query.sales7Max}`);
  }
  // Typed sales14 (Int? window); NULL excluded when either bound is set.
  if (query.sales14Min != null || query.sales14Max != null) {
    filters.push(Prisma.sql`s."sales14" IS NOT NULL`);
    if (query.sales14Min != null) filters.push(Prisma.sql`s."sales14">=${query.sales14Min}`);
    if (query.sales14Max != null) filters.push(Prisma.sql`s."sales14"<=${query.sales14Max}`);
  }
  // Typed listingQuantity (payload.quantity); NULL excluded when either bound is set.
  if (query.listingQuantityMin != null || query.listingQuantityMax != null) {
    filters.push(Prisma.sql`s."listingQuantity" IS NOT NULL`);
    if (query.listingQuantityMin != null) filters.push(Prisma.sql`s."listingQuantity">=${query.listingQuantityMin}`);
    if (query.listingQuantityMax != null) filters.push(Prisma.sql`s."listingQuantity"<=${query.listingQuantityMax}`);
  }
  // Typed reservedQty; NULL excluded when either bound is set.
  if (query.reservedQtyMin != null || query.reservedQtyMax != null) {
    filters.push(Prisma.sql`s."reservedQty" IS NOT NULL`);
    if (query.reservedQtyMin != null) filters.push(Prisma.sql`s."reservedQty">=${query.reservedQtyMin}`);
    if (query.reservedQtyMax != null) filters.push(Prisma.sql`s."reservedQty"<=${query.reservedQtyMax}`);
  }
  // Typed unsellable; NULL excluded when either bound is set.
  if (query.unsellableMin != null || query.unsellableMax != null) {
    filters.push(Prisma.sql`s."unsellable" IS NOT NULL`);
    if (query.unsellableMin != null) filters.push(Prisma.sql`s."unsellable">=${query.unsellableMin}`);
    if (query.unsellableMax != null) filters.push(Prisma.sql`s."unsellable"<=${query.unsellableMax}`);
  }
  // Typed warehousing; NULL excluded when either bound is set.
  if (query.warehousingMin != null || query.warehousingMax != null) {
    filters.push(Prisma.sql`s."warehousing" IS NOT NULL`);
    if (query.warehousingMin != null) filters.push(Prisma.sql`s."warehousing">=${query.warehousingMin}`);
    if (query.warehousingMax != null) filters.push(Prisma.sql`s."warehousing"<=${query.warehousingMax}`);
  }
  const searchKeys = ["asin", "msku", "sku", "title", "parentAsin"];
  if (query.searchType && !searchKeys.includes(query.searchType)) throw new SellfoxBrowseError("当前域不支持该搜索类型。");
  if (query.search) {
    // Default search retains its original ASIN/MSKU/SKU/title behavior.
    const keys = query.searchType ? [query.searchType] : searchKeys.slice(0, 4);
    filters.push(Prisma.sql`(${Prisma.join(keys.map(key => {
      const field = Prisma.raw(`s."${key}"`); // closed local allowlist
      return query.exactMatch ? Prisma.sql`lower(${field})=lower(${query.search})` : Prisma.sql`${field} ILIKE ${`%${query.search}%`}`;
    }), " OR ")})`);
  }
  const sortKey = sellfoxSortKey("listings", query);
  const order = sortKey ? sellfoxSqlOrder(query, Prisma.raw(`"${sortKey === "rating" ? "ratingValue" : sortKey}"`)) : Prisma.sql`id`;
  const rowKeys = [...sellfoxAgentColumns.listings, ...projectedColumns];
  const columns = Prisma.join(rowKeys.map(key => Prisma.raw(`s."${key}"`)));
  const pageColumns = Prisma.join([...rowKeys, "storeName", "storeSite", "listingTitle", "listingPrice", "listingParentAsin", "listingMainImage"].map(key => Prisma.raw(`"${key}"`)));
  // NOT MATERIALIZED lets count/totals prune display columns and lets the page use
  // an ordered index + LIMIT. A shared wide materialized CTE defeats both.
  // Facets intentionally ignore row filters, but keep organization/workspace/shop/site.
  const facets = exporting ? Prisma.empty : Prisma.sql`,facet_source AS MATERIALIZED (
    SELECT s.brand,s."productTagNames",s."dxmPublishState",s."bsrCategory" FROM sellfox_listing_current s WHERE ${Prisma.join(scopeFilters, " AND ")}
  )`;
  return Prisma.sql`WITH filtered AS NOT MATERIALIZED (
    SELECT ${columns},s."ratingValue",s.name AS "storeName",s.marketplace AS "storeSite",
      s.title AS "listingTitle",s.price AS "listingPrice",s."parentAsin" AS "listingParentAsin",s."mainImage" AS "listingMainImage"
    FROM sellfox_listing_current s WHERE ${Prisma.join(filters, " AND ")}
  ), counts AS MATERIALIZED (SELECT currency,count(*)::int AS count FROM filtered GROUP BY currency)${facets}
  SELECT (SELECT COALESCE(sum(count),0)::int FROM counts) AS total,
    (SELECT COALESCE(jsonb_agg(c),'[]'::jsonb) FROM counts c) AS totals,
    COALESCE((SELECT jsonb_agg(p) FROM (SELECT ${pageColumns} FROM filtered ORDER BY ${order}
      LIMIT ${exporting ? sellfoxExportLimit + 1 : query.pageSize} OFFSET ${exporting ? 0 : (query.page - 1) * query.pageSize}) p),'[]'::jsonb) AS rows
    ${exporting ? Prisma.empty : Prisma.sql`,jsonb_build_object('productTags',
      ARRAY(SELECT DISTINCT tag FROM facet_source CROSS JOIN LATERAL unnest("productTagNames") tag ORDER BY tag),
      'brands',ARRAY(SELECT DISTINCT brand FROM facet_source WHERE brand IS NOT NULL ORDER BY brand),
      'dxmPublishStates',ARRAY(SELECT DISTINCT "dxmPublishState" FROM facet_source WHERE "dxmPublishState" IS NOT NULL ORDER BY 1),
      'bsrCategories',ARRAY(SELECT DISTINCT "bsrCategory" FROM facet_source WHERE "bsrCategory" IS NOT NULL ORDER BY 1)) AS facets`}`;
}
