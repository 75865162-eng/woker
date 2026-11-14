import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { HostDataset } from "./host-pages";

/**
 * 承接页只读数据层。
 *
 * 只读已落库的快照：不在这里发赛狐请求，也不补算缺失值。
 * - 广告类：Prisma 模型查询（列名与 schema 一致），衍生指标（CTR/CPC/ACOS/ROAS）在内存里按公式算，分母缺失即留空。
 * - 库存类：读视图 sellfox_inventory_current（已按 SnapshotHead 取最近一次完整采集）。
 * - 金额合计按币种分组输出，不跨币种相加。
 */

export type HostQuery = {
  from: string;
  to: string;
  site: string;
  shop: string;
  search: string;
  adType: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
};

export type HostRow = Record<string, unknown>;

export type HostResult = {
  rows: HostRow[];
  total: number;
  totals: {
    impressions: number | null;
    clicks: number | null;
    adOrders: number | null;
    /** 金额按币种分组，跨币种不合并；values 的键就是列 key。 */
    byCurrency: { currency: string; values: Record<string, number | null> }[];
    /** 库存类合计：任一行缺值即整列为 null。 */
    quantity?: number | null;
    totalInventory?: number | null;
    unfulfillable?: number | null;
  };
  coverage: { stores: number; rows: number };
  grain: string;
};

type Scope = { organizationId: string; workspaceId: string };

type AdsDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<HostRow[]>;
  count: (args: Record<string, unknown>) => Promise<number>;
  groupBy: (args: Record<string, unknown>) => Promise<HostRow[]>;
};

const adsSortable = new Set(["reportDate", "impressions", "clicks", "cost", "adOrders", "adSales"]);

const adsReaders: Record<string, { delegate: () => AdsDelegate; fields: string[]; searchFields: string[] }> = {
  ads_product: {
    delegate: () => prisma.sellfoxAdsProductDaily as unknown as AdsDelegate,
    fields: ["campaignId", "adGroupId", "productId", "asin", "msku"],
    searchFields: ["asin", "msku", "campaignId", "adGroupId", "productId"],
  },
  ads_campaign: {
    delegate: () => prisma.sellfoxAdsCampaignDaily as unknown as AdsDelegate,
    fields: ["campaignId", "campaignName", "asin", "msku"],
    searchFields: ["campaignName", "campaignId", "asin", "msku"],
  },
  ads_ad_group: {
    delegate: () => prisma.sellfoxAdsAdGroupDaily as unknown as AdsDelegate,
    fields: ["campaignId", "adGroupId", "adGroupName", "targetingText", "matchType", "asin", "msku"],
    searchFields: ["adGroupName", "campaignId", "adGroupId", "targetingText", "asin", "msku"],
  },
  ads_targeting: {
    delegate: () => prisma.sellfoxAdsTargetingDaily as unknown as AdsDelegate,
    fields: ["campaignId", "adGroupId", "targetingId", "targetingText", "matchType", "asin", "msku"],
    searchFields: ["targetingText", "targetingId", "campaignId", "adGroupId", "asin", "msku"],
  },
  ads_placement: {
    delegate: () => prisma.sellfoxAdsPlacementDaily as unknown as AdsDelegate,
    fields: ["campaignId", "placement", "adGroupId", "asin", "msku"],
    searchFields: ["placement", "campaignId", "asin", "msku"],
  },
  ads_search_term: {
    delegate: () => prisma.sellfoxAdsSearchTermDaily as unknown as AdsDelegate,
    fields: ["campaignId", "adGroupId", "searchTerm", "targetingId", "targetingText", "matchType", "asin", "msku"],
    searchFields: ["searchTerm", "targetingText", "campaignId", "adGroupId", "asin", "msku"],
  },
};

function ratio(numerator: unknown, denominator: unknown) {
  const left = typeof numerator === "number" ? numerator : Number(numerator);
  const right = typeof denominator === "number" ? denominator : Number(denominator);
  if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) return null;
  return left / right;
}

function sumField(rows: HostRow[], field: string) {
  let total = 0;
  for (const row of rows) {
    const sum = (row._sum ?? {}) as Record<string, number | null>;
    total += Number(sum[field] ?? 0);
  }
  return total;
}

async function storeFilter(scope: Scope, query: Pick<HostQuery, "site" | "shop">) {
  if (!query.site && !query.shop) return null;
  const stores = await prisma.sellfoxStore.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ...(query.site ? { marketplace: query.site } : {}),
      ...(query.shop ? { externalId: query.shop } : {}),
    },
    select: { id: true },
  });
  return stores.map((store) => store.id);
}

function decorate(rows: HostRow[]) {
  return rows.map((row) => ({
    ...row,
    store: [row.storeName, row.storeMarketplace].filter(Boolean).join(" / "),
    ctr: ratio(row.clicks, row.impressions),
    cpc: ratio(row.cost, row.clicks),
    acos: ratio(row.cost, row.adSales),
    roas: ratio(row.adSales, row.cost),
  }));
}

async function readAds(readerKey: string, scope: Scope, query: HostQuery): Promise<HostResult> {
  const reader = adsReaders[readerKey];
  const storeIds = await storeFilter(scope, query);
  if (storeIds && storeIds.length === 0) {
    return { rows: [], total: 0, totals: { impressions: null, clicks: null, adOrders: null, byCurrency: [] }, coverage: { stores: 0, rows: 0 }, grain: "按日 × 店铺" };
  }
  const where: Record<string, unknown> = {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...(storeIds ? { storeId: { in: storeIds } } : {}),
    reportDate: { gte: query.from, lte: query.to },
    ...(query.adType ? { adType: query.adType } : {}),
    ...(query.search ? { OR: reader.searchFields.map((field) => ({ [field]: { contains: query.search, mode: "insensitive" } })) } : {}),
  };
  const orderBy = [
    { [adsSortable.has(query.sortBy) ? query.sortBy : "reportDate"]: query.sortOrder },
    ...(query.sortBy === "reportDate" ? [{ cost: "desc" }] : [{ reportDate: "desc" }]),
  ];
  const select: Record<string, unknown> = {
    id: true,
    storeId: true,
    reportDate: true,
    adType: true,
    currency: true,
    impressions: true,
    clicks: true,
    cost: true,
    adOrders: true,
    adSales: true,
    SellfoxStore: { select: { name: true, marketplace: true, externalId: true } },
  };
  for (const field of reader.fields) select[field] = true;

  const delegate = reader.delegate();
  const [rows, total, byStore, sums] = await Promise.all([
    delegate.findMany({ where, select, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    delegate.count({ where }),
    delegate.groupBy({ by: ["storeId"], where }),
    delegate.groupBy({ by: ["currency"], where, _sum: { impressions: true, clicks: true, cost: true, adOrders: true, adSales: true } }),
  ]);

  const flat = rows.map((row) => {
    const store = (row.SellfoxStore ?? {}) as { name?: string; marketplace?: string };
    return {
      ...row,
      SellfoxStore: undefined,
      storeName: store.name ?? "",
      storeMarketplace: store.marketplace ?? "",
    } as HostRow;
  });
  const byCurrency = sums
    .map((row) => {
      const sum = (row._sum ?? {}) as Record<string, number | null>;
      return {
        currency: typeof row.currency === "string" ? row.currency : "",
        values: { cost: sum.cost ?? null, adSales: sum.adSales ?? null } as Record<string, number | null>,
      };
    })
    .sort((left, right) => left.currency.localeCompare(right.currency));

  return {
    rows: decorate(flat),
    total,
    totals: {
      impressions: sums.reduce((total, row) => total + Number(((row._sum ?? {}) as Record<string, number | null>).impressions ?? 0), 0),
      clicks: sums.reduce((total, row) => total + Number(((row._sum ?? {}) as Record<string, number | null>).clicks ?? 0), 0),
      adOrders: sums.reduce((total, row) => total + Number(((row._sum ?? {}) as Record<string, number | null>).adOrders ?? 0), 0),
      byCurrency,
    },
    coverage: { stores: byStore.length, rows: total },
    grain: "按日 × 店铺",
  };
}

async function readHourly(scope: Scope, query: HostQuery): Promise<HostResult> {
  const storeIds = await storeFilter(scope, query);
  if (storeIds && storeIds.length === 0) {
    return { rows: [], total: 0, totals: { impressions: null, clicks: null, adOrders: null, byCurrency: [] }, coverage: { stores: 0, rows: 0 }, grain: "按小时 × 活动" };
  }
  const where = {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...(storeIds ? { storeId: { in: storeIds } } : {}),
    reportDate: { gte: query.from, lte: query.to },
    ...(query.adType ? { adType: query.adType } : {}),
    ...(query.search ? { entityName: { contains: query.search, mode: "insensitive" as const } } : {}),
  };
  const [rows, total, byStore, byCurrency] = await Promise.all([
    prisma.sellfoxHourlyMetric.findMany({
      where,
      orderBy: [{ reportDate: "desc" }, { hour: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, storeId: true, reportDate: true, hour: true, adType: true, entityType: true, entityName: true,
        impressions: true, clicks: true, cost: true, sales: true, orders: true,
        SellfoxStore: { select: { name: true, marketplace: true } },
      },
    }),
    prisma.sellfoxHourlyMetric.count({ where }),
    prisma.sellfoxHourlyMetric.groupBy({ by: ["storeId"], where }),
    prisma.sellfoxHourlyMetric.groupBy({ by: ["adType"], where, _sum: { impressions: true, clicks: true, cost: true, orders: true } }),
  ]);
  const flat = rows.map((row) => ({
    ...row,
    store: [row.SellfoxStore?.name, row.SellfoxStore?.marketplace].filter(Boolean).join(" / "),
    adOrders: row.orders,
    adSales: row.sales,
  }));
  return {
    rows: flat,
    total,
    totals: {
      impressions: sumField(byCurrency, "impressions"),
      clicks: sumField(byCurrency, "clicks"),
      adOrders: sumField(byCurrency, "orders"),
      byCurrency: [],
    },
    coverage: { stores: byStore.length, rows: total },
    grain: "按小时 × 活动（仅 SP）",
  };
}

type InventoryRow = {
  id: string; storeId: string; shopExternalId: string; name: string; marketplace: string;
  reportDate: string; asin: string; msku: string; sku: string; fnsku: string; commodityName: string | null;
  quantity: number | null; totalInventory: number | null; inboundWorking: number | null; inboundShipped: number | null;
  inboundReceiving: number | null; reservedCustomerorders: number | null; unfulfillable: number | null;
  warehouseName: string | null; currency: string | null;
  total_count: bigint;
};

async function readInventoryFba(scope: Scope, query: HostQuery): Promise<HostResult> {
  const search = query.search.trim();
  const searchFilter = search
    ? Prisma.sql`AND (i.asin ILIKE ${`%${search}%`} OR i.msku ILIKE ${`%${search}%`} OR i.sku ILIKE ${`%${search}%`} OR i.fnsku ILIKE ${`%${search}%`} OR i."commodityName" ILIKE ${`%${search}%`})`
    : Prisma.empty;
  const siteFilter = query.site ? Prisma.sql`AND i.marketplace = ${query.site}` : Prisma.empty;
  const shopFilter = query.shop ? Prisma.sql`AND i."shopExternalId" = ${query.shop}` : Prisma.empty;
  const where = Prisma.sql`WHERE i."organizationId" = ${scope.organizationId} AND i."workspaceId" = ${scope.workspaceId} ${siteFilter} ${shopFilter} ${searchFilter}`;

  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<InventoryRow[]>(Prisma.sql`
      SELECT i.id, i."storeId", i."shopExternalId", i.name, i.marketplace, i."reportDate", i.asin, i.msku, i.sku, i.fnsku,
             i."commodityName", i.quantity, i."totalInventory", i."inboundWorking", i."inboundShipped", i."inboundReceiving",
             i."reservedCustomerorders", i.unfulfillable, i."warehouseName", i.currency, count(*) OVER () AS total_count
      FROM sellfox_inventory_current i
      ${where}
      ORDER BY i."totalInventory" DESC NULLS LAST, i.asin ASC, i.msku ASC
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
    prisma.$queryRaw<{ stores: bigint; quantity: number | null; total_inventory: number | null; unfulfillable: number | null; known: bigint }[]>(Prisma.sql`
      SELECT count(DISTINCT i."storeId") AS stores,
             CASE WHEN count(i.quantity) = count(*) THEN sum(i.quantity)::float END AS quantity,
             CASE WHEN count(i."totalInventory") = count(*) THEN sum(i."totalInventory")::float END AS total_inventory,
             CASE WHEN count(i.unfulfillable) = count(*) THEN sum(i.unfulfillable)::float END AS unfulfillable,
             count(*) AS known
      FROM sellfox_inventory_current i ${where}`),
  ]);

  const total = Number(rows[0]?.total_count ?? 0);
  const summary = totals[0];
  return {
    rows: rows.map((row) => ({ ...row, store: `${row.name} / ${row.marketplace}`, total_count: undefined })),
    total,
    totals: {
      impressions: null,
      clicks: null,
      adOrders: null,
      byCurrency: [],
      quantity: summary?.quantity ?? null,
      totalInventory: summary?.total_inventory ?? null,
      unfulfillable: summary?.unfulfillable ?? null,
    },
    coverage: { stores: Number(summary?.stores ?? 0), rows: Number(summary?.known ?? 0) },
    grain: "最近一次完整采集",
  };
}

export async function readHostDataset(dataset: HostDataset, scope: Scope, query: HostQuery): Promise<HostResult> {
  if (dataset.reader && adsReaders[dataset.reader]) return readAds(dataset.reader, scope, query);
  if (dataset.reader === "hourly") return readHourly(scope, query);
  if (dataset.reader === "inventory_fba") return readInventoryFba(scope, query);
  throw new Error("该数据集尚未接入读取。");
}
