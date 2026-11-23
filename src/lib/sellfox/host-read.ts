import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSellfoxStoreScope } from "@/lib/accounts/effective-access";
import type { HostDataset } from "./host-pages";
import type { HostColumn } from "./host-page-schema";
import { moneyToNumber } from "./money-display";

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
  /** 实体当前态筛选：enabled/paused/archived；仅对 stateFilter 数据集生效。 */
  state?: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
};

/** state 筛选白名单：来自实见 payload 的 state 取值，不接受任意键值注入。 */
export const ADS_ENTITY_STATES = ["enabled", "paused", "archived"] as const;
export function normalizeAdsEntityState(value: string | null | undefined): string {
  return value && (ADS_ENTITY_STATES as readonly string[]).includes(value) ? value : "";
}

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
    /** 汇总视图：先汇总分子分母再计算的派生合计（按币种），与行内比率为同一口径。 */
    derivedByCurrency?: { currency: string; values: Record<string, number | null> }[];
  };
  coverage: { stores: number; rows: number };
  grain: string;
  /** 原始行数据集：列由真实 payload 键动态派生，前端据此渲染，不套用规划列。 */
  columns?: HostColumn[];
  /** 汇总视图的候选值计数（候选值不受自身筛选影响，标注各自 scope）。 */
  facets?: {
    states?: { value: string; count: number }[];
    buckets?: { value: string; count: number }[];
  };
};

type Scope = { organizationId: string; workspaceId: string; userId?: string };

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
  if (numerator == null || denominator == null) return null;
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

/** 店铺授权收窄：供其它只读 reader（实体汇总）复用同一授权口径，避免第二套权限逻辑。 */
export async function resolveStoreIds(scope: Scope, query: Pick<HostQuery, "site" | "shop">) {
  return storeFilter(scope, query);
}

async function storeFilter(scope: Scope, query: Pick<HostQuery, "site" | "shop">) {
  // P0 数据隔离：存在明确 SELLFOX_STORE 授权时，读取前强制限定店铺范围（空集合即拒绝）。
  // 双读期无授权数据的用户返回 null，回退现有行为，避免误伤历史账号。
  const authorizedIds = scope.userId
    ? await getSellfoxStoreScope({
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
      })
    : null;

  if (!query.site && !query.shop) return authorizedIds;

  const stores = await prisma.sellfoxStore.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ...(query.site ? { marketplace: query.site } : {}),
      ...(query.shop ? { externalId: query.shop } : {}),
      ...(authorizedIds ? { id: { in: authorizedIds } } : {}),
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
    delegate.groupBy({
      by: ["currency"], where,
      _sum: { impressions: true, clicks: true, cost: true, adOrders: true, adSales: true },
      _count: { _all: true, impressions: true, clicks: true, cost: true, adOrders: true, adSales: true },
    }),
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
  const observedSums = sums.map((row) => {
    const sum = (row._sum ?? {}) as Record<string, number | null>;
    const count = (row._count ?? {}) as Record<string, number>;
    const values: Record<string, number | null> = {};
    for (const field of ["impressions", "clicks", "cost", "adOrders", "adSales"]) {
      values[field] = count._all > 0 && count[field] === count._all ? sum[field] ?? null : null;
    }
    return { currency: typeof row.currency === "string" ? row.currency : "", values };
  });
  const byCurrency = observedSums
    .map(({ currency, values }) => ({
      currency,
      values: { cost: values.cost, adSales: values.adSales },
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));

  return {
    rows: decorate(flat),
    total,
    totals: {
      impressions: observedSums.reduce<number | null>((total, row) => total == null || row.values.impressions == null ? null : total + row.values.impressions, observedSums.length ? 0 : null),
      clicks: observedSums.reduce<number | null>((total, row) => total == null || row.values.clicks == null ? null : total + row.values.clicks, observedSums.length ? 0 : null),
      adOrders: observedSums.reduce<number | null>((total, row) => total == null || row.values.adOrders == null ? null : total + row.values.adOrders, observedSums.length ? 0 : null),
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
    cost: moneyToNumber(row.cost),
    sales: moneyToNumber(row.sales),
    store: [row.SellfoxStore?.name, row.SellfoxStore?.marketplace].filter(Boolean).join(" / "),
    adOrders: row.orders,
    adSales: moneyToNumber(row.sales),
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

/**
 * 原始行数据集：从 SellfoxApiRecord 按 endpointCode 读真实 payload 行，
 * 列由样本 payload 的真实键派生（不猜字段、不补零、不做金额换算）。
 * 用于把「有真实数据但从未接 typed 表」的域（采购/商品/财务）以原始行方式诚实呈现。
 */

/** 原始行里稳定展示的键优先序：身份/时间/金额在前，其余按出现顺序。 */
const RAW_KEY_ORDER = [
  "name", "supplierName", "purchaseNo", "purchaseOrderNo", "sku", "spu", "msku", "asin",
  "commodityName", "title", "status", "currency", "amount", "price", "quantity", "num",
  "createdTime", "createTime", "updateTime", "syncedAt", "id",
];

const RAW_LABELS: Record<string, string> = {
  id: "行 ID", name: "名称", supplierName: "供应商", supplierId: "供应商ID",
  purchaseNo: "采购单号", purchaseOrderNo: "采购单号", sku: "SKU", spu: "SPU",
  msku: "MSKU", asin: "ASIN", commodityName: "品名", title: "标题", status: "状态",
  currency: "币种", amount: "金额", price: "价格", quantity: "数量", num: "数量",
  createdTime: "创建时间", createTime: "创建时间", updateTime: "更新时间",
  syncedAt: "同步时间", reportDate: "报告日期", period: "期间", externalId: "行身份",
  brand: "品牌", model: "型号", purchaseCost: "采购成本", developer: "开发员",
  memberName: "业务员", ownerName: "负责人", storage: "仓库", warehouse: "仓库",
};

const RAW_MAX_COLUMNS = 30;

function rawKeyKind(key: string): HostColumn["kind"] {
  if (/amount|price|cost|fee|revenue|profit|balance/i.test(key)) return "money";
  if (/quantity|qty|num|count/i.test(key)) return "qty";
  if (/at$|time|date/i.test(key)) return "text";
  return "text";
}

function deriveRawColumns(rows: HostRow[]): HostColumn[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) if (!key.startsWith("_")) seen.add(key);
  const ordered = [
    ...RAW_KEY_ORDER.filter((key) => seen.has(key)),
    ...[...seen].filter((key) => !RAW_KEY_ORDER.includes(key)).sort(),
  ].slice(0, RAW_MAX_COLUMNS);
  return ordered.map((key) => ({ key, label: RAW_LABELS[key] ?? key, kind: rawKeyKind(key) }));
}

async function readRawEndpoint(dataset: HostDataset, scope: Scope, query: HostQuery): Promise<HostResult> {
  const code = dataset.rawCode;
  if (!code || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(code)) throw new Error("原始端点 code 无效。");
  const endpoint = await prisma.sellfoxApiEndpoint.findUnique({
    where: { organizationId_workspaceId_code: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, code } },
    select: { scopeMode: true },
  });
  if (!endpoint) throw new Error("该原始端点在本工作区未登记。");

  const storeIds = await storeFilter(scope, query);
  // 原始行 storeId 存的是 SellfoxStore.id；授权收窄传的是同一 id 集合。
  const storeClause = endpoint.scopeMode === "store" && storeIds
    ? Prisma.sql`AND r."storeId" IN (${Prisma.join(storeIds)})`
    : Prisma.empty;
  const search = query.search.trim();
  const searchClause = search ? Prisma.sql`AND r."payload"::text ILIKE ${`%${search}%`}` : Prisma.empty;
  // 实体当前态筛选：只对声明 stateFilter 且 state 在白名单内的数据集生效；
  // 键名来自实见 payload 的 state，不猜字段、不覆盖 servingStatus。
  const state = dataset.stateFilter ? normalizeAdsEntityState(query.state) : "";
  const stateClause = state ? Prisma.sql`AND r."payload"->>'state' = ${state}` : Prisma.empty;
  const base = Prisma.sql`
    FROM "SellfoxApiRecord" r
    WHERE r."organizationId" = ${scope.organizationId}
      AND r."workspaceId" = ${scope.workspaceId}
      AND r."endpointCode" = ${code}
      ${storeClause} ${searchClause} ${stateClause}`;

  const [countRows, records] = await Promise.all([
    prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS total ${base}`),
    prisma.$queryRaw<{ payload: Prisma.JsonValue; syncedAt: Date; storeId: string | null }[]>(Prisma.sql`
      SELECT r."payload", r."syncedAt", r."storeId" ${base}
      ORDER BY r."syncedAt" DESC, r."id" DESC
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
  ]);

  const rows: HostRow[] = records.map((record) => {
    const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
      ? record.payload as HostRow
      : {};
    return { ...payload, id: payload.id ?? payload.externalId ?? record.syncedAt.toISOString(), _syncedAt: record.syncedAt.toISOString() };
  });
  const total = Number(countRows[0]?.total ?? 0);
  return {
    rows,
    total,
    totals: { impressions: null, clicks: null, adOrders: null, byCurrency: [] },
    coverage: { stores: 0, rows: total },
    grain: dataset.grain,
    columns: deriveRawColumns(rows),
  };
}

export async function readHostDataset(dataset: HostDataset, scope: Scope, query: HostQuery): Promise<HostResult> {
  if (dataset.rawCode) return readRawEndpoint(dataset, scope, query);
  if (dataset.reader && adsReaders[dataset.reader]) return readAds(dataset.reader, scope, query);
  if (dataset.reader === "hourly") return readHourly(scope, query);
  if (dataset.reader === "inventory_fba") return readInventoryFba(scope, query);
  throw new Error("该数据集尚未接入读取。");
}
