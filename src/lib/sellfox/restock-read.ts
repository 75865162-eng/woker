import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { SellfoxBrowseQuery } from "./browse-query";
import { inboundUnits, mergeRestockDays, restockDailyRates, restockPrepDays, restockSafetyDays, suggestRestockDate, suggestRestockQuantity, sumKnown, type RestockDay } from "./restock";
import { sellfoxDateAt } from "./sync-contract";
import { sellfoxStoreSyncFailures } from "./sync-failures";
import {
  normalizeSellfoxCacheQuery, readThroughSellfox, sellfoxCacheKey, SELLFOX_VERSION_SOURCE,
} from "./result-cache";

type Scope = { organizationId: string; workspaceId: string };
export type RestockListing = {
  id: string; storeId: string; asin: string; msku: string | null; sku: string | null; parentAsin: string | null; title: string | null; mainImage: string | null;
  fulfillable: number | null; reservedQty: number | null; unsellable: number | null; warehousing: number | null; fulfillment: string | null;
  shopExternalId: string; name: string; marketplace: string;
};
export type RestockSale = { storeId: string; msku: string; asin: string; reportDate: string; quantity: number | null; stockout?: boolean };
export type RestockShipmentLine = { storeId: string; msku: string; asin: string; status: string; declaredQty: number | null; receivedQty: number | null };
export type RestockInventoryDay = { storeId: string; msku: string; reportDate: string; quantity: number | null };

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
  inventory: RestockInventoryDay[];
  shipmentCapturedStoreIds: string[];
  today: string;
  groupBy: "asin" | "msku";
  prepDays?: number;
  safetyDays?: number;
}) {
  const inventory = new Map(input.inventory.map((day) => [JSON.stringify([day.storeId, day.msku, day.reportDate]), day.quantity]));
  const capturedStores = new Set(input.shipmentCapturedStoreIds);
  const groups = new Map<string, RestockListing[]>();
  for (const listing of input.listings) {
    const identity = input.groupBy === "msku" ? listing.msku || listing.asin : listing.asin || listing.msku;
    if (!identity) continue;
    const key = `${listing.storeId}\u0000${identity}`;
    groups.set(key, [...(groups.get(key) ?? []), listing]);
  }
  // 性能：原实现对每个组都在全量 sales(1.2万) / shipments(2.7万) 上 filter，
  // 组数约 9 千 → O(组×明细) 约 3.8 亿次迭代，实测计算 24 秒。
  // 先按 storeId 预分桶，组只需在自己店铺的明细里匹配，语义完全等价（belongs 不变）。
  const salesByStore = new Map<string, RestockSale[]>();
  for (const sale of input.sales) {
    const list = salesByStore.get(sale.storeId);
    if (list) list.push(sale); else salesByStore.set(sale.storeId, [sale]);
  }
  const shipmentsByStore = new Map<string, RestockShipmentLine[]>();
  for (const line of input.shipments) {
    const list = shipmentsByStore.get(line.storeId);
    if (list) list.push(line); else shipmentsByStore.set(line.storeId, [line]);
  }
  return [...groups.entries()].map(([key, listings]) => {
    const [storeId, identity] = key.split("\u0000");
    const members = new Set(listings.flatMap((listing) => [listing.msku, listing.asin].filter((value): value is string => Boolean(value))));
    const belongs = (line: { storeId: string; msku: string; asin: string }) => line.storeId === storeId && (input.groupBy === "msku" ? line.msku === identity : members.has(line.msku) || members.has(line.asin));
    const sales = mergeRestockDays((salesByStore.get(storeId) ?? []).filter(belongs).map((sale): RestockDay => {
      const quantity = inventory.get(JSON.stringify([sale.storeId, sale.msku, sale.reportDate]));
      return { date: sale.reportDate, quantity: sale.quantity, stockout: quantity == null ? undefined : quantity === 0 };
    }));
    const rates = restockDailyRates(sales, input.today);
    const shipmentLines = (shipmentsByStore.get(storeId) ?? []).filter(belongs);
    const fulfillable = sumKnown(listings.map((listing) => listing.fulfillable));
    const inTransit = capturedStores.has(storeId) ? inboundUnits(shipmentLines) : null;
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
    SELECT l.id, l."storeId", l.asin, l.msku, l.sku, l."parentAsin", l.title, l."mainImage", l.fulfillable,
      l."reservedQty"::float8 AS "reservedQty", l.unsellable::float8 AS unsellable, l.warehousing::float8 AS warehousing, l.fulfillment,
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
  const from = addDays(today, -31);
  const to = addDays(today, -2);
  const mskus = [...new Set(searched.map((listing) => listing.msku).filter((msku): msku is string => Boolean(msku)))];
  const [sales, shipmentLines, failures, inventory, shipmentHeads] = await Promise.all([
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
    storeSet.length && mskus.length ? prisma.$queryRaw<RestockInventoryDay[]>(Prisma.sql`
      WITH latest AS (
        SELECT "storeId", "reportDate", MAX("capturedAt") AS "capturedAt"
        FROM "SellfoxFbaInventorySnapshot"
        WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId}
          AND "storeId" IN (${Prisma.join(storeSet)}) AND "reportDate" BETWEEN ${from} AND ${to}
        GROUP BY "storeId", "reportDate"
      )
      SELECT i."storeId", i.msku, i."reportDate",
        CASE WHEN COUNT(i.quantity)=COUNT(*) THEN SUM(i.quantity)::double precision ELSE NULL END AS quantity
      FROM "SellfoxFbaInventorySnapshot" i
      JOIN latest l ON l."storeId"=i."storeId" AND l."reportDate"=i."reportDate" AND l."capturedAt"=i."capturedAt"
      WHERE i."organizationId"=${scope.organizationId} AND i."workspaceId"=${scope.workspaceId}
        AND i.msku IN (${Prisma.join(mskus)})
      GROUP BY i."storeId", i.msku, i."reportDate"`) : [],
    storeSet.length ? prisma.sellfoxSnapshotHead.findMany({
      where: { resource: "fba_shipments", storeId: { in: storeSet }, SellfoxStore: { organizationId: scope.organizationId, workspaceId: scope.workspaceId } },
      select: { storeId: true },
    }) : [],
  ]);
  const groupBy = query.dimension === "msku" ? "msku" : "asin";
  let rows = buildRestockRows({ listings: searched, sales, shipments: shipmentLines, inventory, shipmentCapturedStoreIds: shipmentHeads.map((head) => head.storeId), today, groupBy });
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

/**
 * 补货建议的读缓存包装。补货是全量重查询（listing + 30 天销量 + 库存快照 + 在途），
 * 单次可达数十秒；依赖快照按日/每 3 小时同步，无需秒级实时。
 * 缓存键包含 org + workspace + 归一化查询 + 用户可见店铺集合，保证权限/租户隔离；
 * 数据版本取自库存快照 capturedAt，任一依赖域同步成功后由失效钩子 DEL。
 * Redis 不可用/版本读取失败一律降级为直查，不影响正确性。
 */
export async function readSellfoxRestockCached(
  query: SellfoxBrowseQuery,
  scope: Scope,
  storeIds?: string[],
  today = sellfoxDateAt(new Date()),
) {
  // storeIds 是用户数据范围（权限隔离），必须进键；排序保证同一集合键稳定。
  const storeKey = storeIds ? [...storeIds].sort().join(",") : "__unscoped__";
  const key = sellfoxCacheKey(
    scope.organizationId,
    scope.workspaceId,
    "restock",
    normalizeSellfoxCacheQuery({ ...query, today, storeKey }),
  );
  const source = SELLFOX_VERSION_SOURCE.restock!;
  const result = await readThroughSellfox(
    key,
    "restock",
    async () => {
      const rows = await prisma.$queryRaw<Array<{ v: Date | string | null }>>(Prisma.sql`
        SELECT max(${Prisma.raw(`"${source.column}"`)}) AS v
        FROM ${Prisma.raw(`"${source.model}"`)}
        WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId}`);
      return rows[0]?.v ? new Date(rows[0]!.v).toISOString() : "__empty__";
    },
    () => readSellfoxRestock(query, scope, storeIds, today),
    { isEmpty: body => Array.isArray(body.rows) && body.rows.length === 0 },
  );
  return { ...result.body, cache: { status: result.cache, cachedAt: result.cachedAt } };
}
