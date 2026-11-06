import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { SellfoxBrowseQuery } from "./browse-query";
import { inboundUnits, mergeRestockDays, restockDailyRates, restockPrepDays, restockSafetyDays, suggestRestockDate, suggestRestockQuantity, sumKnown, type RestockDay } from "./restock";
import { sellfoxDateAt } from "./sync-contract";
import { sellfoxStoreSyncFailures } from "./sync-failures";

type Scope = { organizationId: string; workspaceId: string };
export type RestockListing = {
  id: string; storeId: string; asin: string; msku: string | null; sku: string | null; parentAsin: string | null; title: string | null; mainImage: string | null;
  fulfillable: number | null; reservedQty: number | null; unsellable: number | null; warehousing: number | null; fulfillment: string | null;
  shopExternalId: string; name: string; marketplace: string;
};
export type RestockSale = { storeId: string; msku: string; asin: string; reportDate: string; quantity: number | null; stockout?: boolean };
export type RestockShipmentLine = { storeId: string; msku: string; asin: string; status: string; declaredQty: number | null; receivedQty: number | null };

function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function matches(value: string | null | undefined, search: string, exact: boolean) {
  const text = value ?? "";
  return exact ? text.toLowerCase() === search.toLowerCase() : text.toLowerCase().includes(search.toLowerCase());
}

export function buildRestockRows(input: {
  listings: RestockListing[];
  sales: RestockSale[];
  shipments: RestockShipmentLine[];
  today: string;
  groupBy: "asin" | "msku";
  prepDays?: number;
  safetyDays?: number;
}) {
  const groups = new Map<string, RestockListing[]>();
  for (const listing of input.listings) {
    const identity = input.groupBy === "msku" ? listing.msku || listing.asin : listing.asin || listing.msku;
    if (!identity) continue;
    const key = `${listing.storeId}\u0000${identity}`;
    groups.set(key, [...(groups.get(key) ?? []), listing]);
  }
  return [...groups.entries()].map(([key, listings]) => {
    const [storeId, identity] = key.split("\u0000");
    const members = new Set(listings.flatMap((listing) => [listing.msku, listing.asin].filter((value): value is string => Boolean(value))));
    const sales = mergeRestockDays(input.sales.filter((sale) => sale.storeId === storeId && (members.has(sale.msku) || members.has(sale.asin))).map((sale): RestockDay => ({ date: sale.reportDate, quantity: sale.quantity, stockout: sale.stockout })));
    const rates = restockDailyRates(sales, input.today);
    const shipmentLines = input.shipments.filter((line) => line.storeId === storeId && (members.has(line.msku) || members.has(line.asin)));
    const fulfillable = sumKnown(listings.map((listing) => listing.fulfillable));
    const inTransit = inboundUnits(shipmentLines);
    const suggest = suggestRestockQuantity({ fulfillable, inTransit, daily: rates.weighted, prepDays: input.prepDays, safetyDays: input.safetyDays });
    const first = listings.find((listing) => listing.mainImage) ?? listings[0];
    return {
      id: key,
      mainImage: first.mainImage,
      asin: input.groupBy === "asin" ? identity : listings.find((listing) => listing.asin)?.asin ?? "",
      msku: input.groupBy === "msku" ? identity : listings.find((listing) => listing.msku)?.msku ?? "",
      sku: listings.find((listing) => listing.sku)?.sku ?? "",
      title: first.title,
      parentAsin: listings.find((listing) => listing.parentAsin)?.parentAsin ?? null,
      store: [first.name, first.marketplace].filter(Boolean).join(" / "),
      name: first.name,
      marketplace: first.marketplace,
      shopExternalId: first.shopExternalId,
      fulfillable,
      reservedQty: sumKnown(listings.map((listing) => listing.reservedQty)),
      unsellable: sumKnown(listings.map((listing) => listing.unsellable)),
      warehousing: sumKnown(listings.map((listing) => listing.warehousing)),
      inTransit,
      avg7: rates.avg7,
      avg14: rates.avg14,
      avg30: rates.avg30,
      daily: rates.weighted,
      cover: fulfillable != null && rates.weighted != null && rates.weighted > 0 ? fulfillable / rates.weighted : null,
      suggest,
      suggestDate: suggestRestockDate(input.today, suggest, input.prepDays ?? restockPrepDays),
      local: null,
      salesperson: null,
    };
  }).sort((left, right) => (right.suggest ?? -1) - (left.suggest ?? -1) || String(left.asin).localeCompare(String(right.asin)) || String(left.msku).localeCompare(String(right.msku)));
}

export async function readSellfoxRestock(query: SellfoxBrowseQuery, scope: Scope, storeIds?: string[], today = sellfoxDateAt(new Date())) {
  const filters: Prisma.Sql[] = [Prisma.sql`l."organizationId"=${scope.organizationId}`, Prisma.sql`l."workspaceId"=${scope.workspaceId}`];
  if (storeIds) filters.push(storeIds.length ? Prisma.sql`l."storeId" IN (${Prisma.join(storeIds)})` : Prisma.sql`FALSE`);
  if (query.shopExternalIds.length) filters.push(Prisma.sql`st."externalId" IN (${Prisma.join(query.shopExternalIds)})`);
  if (query.site) filters.push(Prisma.sql`st.marketplace=${query.site}`);
  if (query.fulfillment) filters.push(Prisma.sql`l.fulfillment=${query.fulfillment}`);
  const listings = await prisma.$queryRaw<RestockListing[]>(Prisma.sql`
    SELECT l.id, l."storeId", l.asin, l.msku, l.sku, l."parentAsin", l.title, l."mainImage", l.fulfillable, l."reservedQty", l.unsellable, l.warehousing, l.fulfillment,
      st."externalId" AS "shopExternalId", st.name, st.marketplace
    FROM sellfox_listing_current l
    JOIN "SellfoxStore" st ON st.id=l."storeId"
    WHERE ${Prisma.join(filters, " AND ")}`);
  const searched = query.search ? listings.filter((listing) => {
    const field = query.searchType === "asin" ? listing.asin : query.searchType === "msku" ? listing.msku : query.searchType === "sku" ? listing.sku : query.searchType === "title" ? listing.title : query.searchType === "parentAsin" ? listing.parentAsin : null;
    const values = query.searchType ? [field] : [listing.asin, listing.msku, listing.sku, listing.title, listing.parentAsin];
    return values.some((value) => matches(value, query.search, query.exactMatch));
  }) : listings;
  const storeSet = [...new Set(searched.map((listing) => listing.storeId))];
  const from = addDays(today, -36);
  const to = addDays(today, -2);
  const [sales, shipmentLines, failures] = await Promise.all([
    storeSet.length ? prisma.sellfoxSalesDailySnapshot.findMany({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, storeId: { in: storeSet }, reportDate: { gte: from, lte: to } },
      select: { storeId: true, msku: true, asin: true, reportDate: true, quantity: true },
    }) : [],
    storeSet.length ? prisma.$queryRaw<RestockShipmentLine[]>(Prisma.sql`
      SELECT s."storeId", s.msku, s.asin, s.status, s."declaredQty", s."receivedQty"
      FROM "SellfoxFbaShipmentSnapshot" s
      JOIN "SellfoxSnapshotHead" h ON h."storeId"=s."storeId" AND h.resource='fba_shipments' AND h."capturedAt"=s."latestCapturedAt"
      WHERE s."organizationId"=${scope.organizationId} AND s."workspaceId"=${scope.workspaceId} AND s."storeId" IN (${Prisma.join(storeSet)})`) : [],
    sellfoxStoreSyncFailures("fba_shipments", scope),
  ]);
  const groupBy = query.dimension === "msku" ? "msku" : "asin";
  let rows = buildRestockRows({ listings: searched, sales, shipments: shipmentLines, today, groupBy });
  if (query.status === "needs") rows = rows.filter((row) => (row.suggest ?? 0) > 0);
  if (query.status === "covered") rows = rows.filter((row) => row.suggest === 0);
  const start = (query.page - 1) * query.pageSize;
  const known = rows.length > 0 && rows.every((row) => row.suggest != null);
  return {
    rows: rows.slice(start, start + query.pageSize),
    totals: [{ suggest: known ? rows.reduce((sum, row) => sum + Number(row.suggest), 0) : null }],
    facets: { productTags: [] as string[], salespersons: [] as string[] },
    pagination: { page: query.page, pageSize: query.pageSize, total: rows.length },
    failures,
    formula: { prepDays: restockPrepDays, safetyDays: restockSafetyDays, weights: { d7: 0.5, d14: 0.3, d30: 0.2 }, excludedRecentDays: 2 },
  };
}
