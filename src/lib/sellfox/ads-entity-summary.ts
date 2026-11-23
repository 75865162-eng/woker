import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxExportLimit, SellfoxBrowseError } from "./browse-query";
import type { HostColumn, HostDataset } from "./host-page-schema";
import { ADS_BUCKETS, ADS_SUMMARY_SPECS, type AdsSummaryKind, type AdsSummaryQuery, type SummarySpec } from "./ads-summary-spec";
import type { HostResult, HostRow } from "./host-read";
import { resolveStoreIds } from "./host-read";
import { moneyToNumber } from "./money-display";

/**
 * 实体 × 区间表现汇总（方案 §1.1 粒度、§4 聚合合同、§5 筛选合同）。
 *
 * 事实边界：
 * - 行集合 = 区间内日报里真实出现过的实体（活动/组/产品/投放），按 (店铺, 广告类型, 实体ID) 唯一。
 * - 当前态（状态/预算/竞价/日期/组合）来自 SellfoxApiRecord 的 ads_ent_* 当前快照，仅作当前配置展示，
 *   不是历史每日值；实体缺失时留空并标 entityKnown=false，不猜状态。
 * - 指标一律「先在日报原始粒度求和、再算比率」；任一成员日缺值则整列 NULL（不补 0）。
 * - 金额按币种分组，不跨币种相加；多币种混合的实体单独进 "unknown" 桶且金额为 NULL。
 */

const BUCKET_SQL = Prisma.sql`CASE
  WHEN "adOrders" > 0 THEN 'orders'
  WHEN "clicks" > 0 THEN 'clicksNoOrders'
  WHEN "impressions" > 0 THEN 'impressionsNoClicks'
  WHEN "impressions" = 0 AND "clicks" = 0 AND "adOrders" = 0 THEN 'noPerformance'
  ELSE 'insufficient' END`;

function metricClauses(query: AdsSummaryQuery): Prisma.Sql[] {
  const out: Prisma.Sql[] = [];
  const base = (column: string, min?: number, max?: number) => {
    if (min != null) out.push(Prisma.sql`${Prisma.raw(`"${column}"`)} >= ${min}`);
    if (max != null) out.push(Prisma.sql`${Prisma.raw(`"${column}"`)} <= ${max}`);
  };
  base("impressions", query.impressionsMin, query.impressionsMax);
  base("clicks", query.clicksMin, query.clicksMax);
  base("cost", query.costMin, query.costMax);
  base("adOrders", query.adOrdersMin, query.adOrdersMax);
  base("adSales", query.adSalesMin, query.adSalesMax);
  const derived = (expression: Prisma.Sql, min?: number, max?: number) => {
    if (min != null) out.push(Prisma.sql`(${expression}) >= ${min}`);
    if (max != null) out.push(Prisma.sql`(${expression}) <= ${max}`);
  };
  derived(Prisma.sql`clicks::numeric / NULLIF(impressions, 0)`, query.ctrMin, query.ctrMax);
  derived(Prisma.sql`cost / NULLIF(clicks, 0)`, query.cpcMin, query.cpcMax);
  derived(Prisma.sql`cost / NULLIF("adSales", 0)`, query.acosMin, query.acosMax);
  derived(Prisma.sql`"adSales" / NULLIF(cost, 0)`, query.roasMin, query.roasMax);
  return out;
}

const SORTABLE: Record<string, Prisma.Sql> = {
  impressions: Prisma.sql`"impressions"`,
  clicks: Prisma.sql`"clicks"`,
  cost: Prisma.sql`"cost"`,
  adOrders: Prisma.sql`"adOrders"`,
  adSales: Prisma.sql`"adSales"`,
  ctr: Prisma.sql`clicks::numeric / NULLIF(impressions, 0)`,
  cpc: Prisma.sql`cost / NULLIF(clicks, 0)`,
  acos: Prisma.sql`cost / NULLIF("adSales", 0)`,
  roas: Prisma.sql`"adSales" / NULLIF(cost, 0)`,
  reportDates: Prisma.sql`"reportDates"`,
  state: Prisma.sql`entityPayload->>'state'`,
  name: Prisma.sql`COALESCE(entityPayload->>'name', entityPayload->>'keywordText', entityPayload->>'expression', "fallbackName")`,
};

function entCte(spec: SummarySpec, scope: { organizationId: string; workspaceId: string }) {
  const parts = spec.entities.map((entity) => Prisma.sql`
    SELECT ${entity.adType}::text AS "adType",
           (e."payload" ->> ${spec.entityKey}) AS "entityId",
           e."payload" AS payload,
           e."syncedAt" AS "syncedAt",
           s.id AS "storeId"
    FROM "SellfoxApiRecord" e
    JOIN "SellfoxStore" s
      ON s."organizationId" = e."organizationId"
     AND s."workspaceId" = e."workspaceId"
     AND s."externalId" = (e."payload" ->> 'shopId')
    WHERE e."organizationId" = ${scope.organizationId}
      AND e."workspaceId" = ${scope.workspaceId}
      AND e."endpointCode" = ${entity.code}
  `);
  const union = parts.reduce((left, right) => Prisma.sql`${left} UNION ALL ${right}`);
  return Prisma.sql`ent AS (
    SELECT DISTINCT ON ("storeId", "adType", "entityId") "storeId", "adType", "entityId", payload
    FROM (${union}) u
    WHERE "entityId" IS NOT NULL
    ORDER BY "storeId", "adType", "entityId", "syncedAt" DESC
  )`;
}

function emptyResult(spec: SummarySpec, stores: number): HostResult {
  return {
    rows: [],
    total: 0,
    totals: { impressions: null, clicks: null, adOrders: null, byCurrency: [], derivedByCurrency: [] },
    coverage: { stores, rows: 0 },
    grain: spec.grain,
    facets: { states: [], buckets: [] },
  };
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function payloadOf(row: HostRow): Record<string, unknown> {
  const payload = row.entityPayload;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function ratioOf(numerator: unknown, denominator: unknown): number | null {
  const left = toNumber(numerator);
  const right = toNumber(denominator);
  if (left == null || right == null || right === 0) return null;
  return left / right;
}

export async function readAdsEntitySummary(
  dataset: HostDataset,
  scope: { organizationId: string; workspaceId: string; userId?: string },
  query: AdsSummaryQuery,
  kind: AdsSummaryKind,
): Promise<HostResult> {
  const spec = ADS_SUMMARY_SPECS[kind];
  if (!spec) throw new SellfoxBrowseError("未知的广告汇总类型。", 400);
  const stores = await resolveStoreIds(scope, query);
  if (stores && stores.length === 0) return emptyResult(spec, 0);

  const state = typeof query.state === "string" && ["enabled", "paused", "archived"].includes(query.state) ? query.state : "";
  const bucket = query.bucket && (ADS_BUCKETS as readonly string[]).includes(query.bucket) ? query.bucket : "";
  const storeClause = stores ? Prisma.sql`AND d."storeId" IN (${Prisma.join(stores)})` : Prisma.empty;
  const adTypeClause = query.adType ? Prisma.sql`AND d."adType" = ${query.adType}` : Prisma.empty;
  const dailyId = Prisma.raw(`"${spec.idColumn}"`);
  const fallbackName = spec.fallbackNameColumn ? Prisma.sql`min(d.${Prisma.raw(`"${spec.fallbackNameColumn}"`)})` : Prisma.sql`NULL::text`;
  const parentSelect = spec.parentColumns.length
    ? Prisma.sql`,${Prisma.join(spec.parentColumns.map((column) => Prisma.sql`min(d.${Prisma.raw(`"${column}"`)}) AS ${Prisma.raw(`"${column}"`)}`))}`
    : Prisma.empty;
  const search = query.search.trim();
  const searchClause = search
    ? Prisma.sql`AND (d.${dailyId} ILIKE ${`%${search}%`} ${spec.fallbackNameColumn ? Prisma.sql`OR d.${Prisma.raw(`"${spec.fallbackNameColumn}"`)} ILIKE ${`%${search}%`}` : Prisma.empty})`
    : Prisma.empty;

  // 当前区间的实体汇总（严格「先求和、后算比率」；任一成员缺值 → NULL，不补 0）。
  const agg = Prisma.sql`agg AS (
    SELECT d."storeId", d."adType", d.${dailyId} AS "entityId",
      CASE WHEN count(DISTINCT d."currency") = 1 THEN min(d."currency") END AS currency,
      CASE WHEN count(d."impressions") = count(*) THEN sum(d."impressions")::bigint END AS "impressions",
      CASE WHEN count(d."clicks") = count(*) THEN sum(d."clicks")::bigint END AS "clicks",
      CASE WHEN count(d."cost") = count(*) THEN sum(d."cost")::numeric END AS "cost",
      CASE WHEN count(d."adOrders") = count(*) THEN sum(d."adOrders")::bigint END AS "adOrders",
      CASE WHEN count(d."adSales") = count(*) THEN sum(d."adSales")::numeric END AS "adSales",
      count(*) AS "reportRows",
      count(DISTINCT d."reportDate") AS "reportDates",
      min(d."reportDate") AS "firstDate",
      max(d."reportDate") AS "lastDate",
      ${fallbackName} AS "fallbackName"
      ${parentSelect}
    FROM ${Prisma.raw(`"${spec.dailyTable}"`)} d
    WHERE d."organizationId" = ${scope.organizationId}
      AND d."workspaceId" = ${scope.workspaceId}
      AND d."reportDate" >= ${query.from}
      AND d."reportDate" <= ${query.to}
      ${storeClause} ${adTypeClause} ${searchClause}
    GROUP BY d."storeId", d."adType", d.${dailyId}
  )`;

  const base = Prisma.sql`base AS (
    SELECT a.*, ent.payload AS "entityPayload"
    FROM agg a
    LEFT JOIN ent
      ON ent."storeId" = a."storeId"
     AND ent."adType" = a."adType"
     AND ent."entityId" = a."entityId"
  )`;

  const filters: Prisma.Sql[] = [Prisma.sql`true`];
  if (state) filters.push(Prisma.sql`entityPayload->>'state' = ${state}`);
  if (bucket) filters.push(Prisma.sql`${BUCKET_SQL} = ${bucket}`);
  filters.push(...metricClauses(query));

  const scoped = Prisma.sql`scoped AS (SELECT * FROM base WHERE ${Prisma.join(filters, " AND ")})`;

  const hasSort = typeof query.sortBy === "string" && Object.prototype.hasOwnProperty.call(SORTABLE, query.sortBy);
  const sortBy = hasSort ? query.sortBy : "cost";
  const sortOrder = query.sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const order = Prisma.sql`${SORTABLE[sortBy]} ${sortOrder} NULLS LAST, "entityId" ASC`;

  const limit = query.exportAll ? sellfoxExportLimit + 1 : query.pageSize;
  const offset = query.exportAll ? 0 : (query.page - 1) * query.pageSize;
  const parentRowSelect = spec.parentColumns.length
    ? Prisma.sql`,${Prisma.join(spec.parentColumns.map((column) => Prisma.raw(`"${column}"`)))}`
    : Prisma.empty;

  const sql = Prisma.sql`
    WITH ${agg}, ${entCte(spec, scope)}, ${base}, ${scoped}
    SELECT
      (SELECT count(*)::int FROM scoped) AS "total",
      (SELECT count(*)::int FROM scoped) AS "counted",
      (SELECT COALESCE(jsonb_agg(t ORDER BY t.currency), '[]'::jsonb) FROM (
        SELECT COALESCE(currency, '') AS currency,
          count(*)::int AS entities,
          CASE WHEN count("impressions") = count(*) THEN sum("impressions")::bigint END AS "impressions",
          CASE WHEN count("clicks") = count(*) THEN sum("clicks")::bigint END AS "clicks",
          CASE WHEN count("cost") = count(*) THEN sum("cost")::numeric END AS "cost",
          CASE WHEN count("adOrders") = count(*) THEN sum("adOrders")::bigint END AS "adOrders",
          CASE WHEN count("adSales") = count(*) THEN sum("adSales")::numeric END AS "adSales"
        FROM scoped GROUP BY 1
      ) t) AS "totals",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('value', v, 'count', c) ORDER BY v), '[]'::jsonb) FROM (
        SELECT COALESCE(entityPayload->>'state', '') AS v, count(*)::int AS c FROM base GROUP BY 1
      ) s) AS "states",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('value', v, 'count', c) ORDER BY v), '[]'::jsonb) FROM (
        SELECT ${BUCKET_SQL} AS v, count(*)::int AS c FROM base GROUP BY 1
      ) s) AS "buckets",
      COALESCE((SELECT jsonb_agg(p) FROM (
        SELECT "storeId", "adType", "entityId", currency, "impressions", "clicks", "cost", "adOrders", "adSales",
          "reportRows", "reportDates", "firstDate", "lastDate"${parentRowSelect},
          CASE WHEN "impressions" > 0 THEN "clicks"::numeric / "impressions" END AS ctr,
          CASE WHEN "clicks" > 0 THEN "cost" / "clicks" END AS cpc,
          CASE WHEN "adSales" <> 0 THEN "cost" / "adSales" END AS acos,
          CASE WHEN "cost" > 0 THEN "adSales" / "cost" END AS roas,
          CASE WHEN entityPayload IS NOT NULL THEN true ELSE false END AS "entityKnown",
          entityPayload
        FROM scoped ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}
      ) p), '[]'::jsonb) AS "rows"
  `;

  const result = await prisma.$queryRaw<Array<{
    total: number;
    totals: Array<{ currency: string; entities: number; impressions: unknown; clicks: unknown; cost: unknown; adOrders: unknown; adSales: unknown }>;
    states: Array<{ value: string; count: number }>;
    buckets: Array<{ value: string; count: number }>;
    rows: HostRow[];
  }>>(sql);
  const head = result[0];
  if (!head) return emptyResult(spec, stores?.length ?? 0);

  if (query.exportAll && Number(head.total) > sellfoxExportLimit) {
    throw new SellfoxBrowseError(`筛选结果超过${sellfoxExportLimit}条，请缩小范围；未导出部分文件。`, 413);
  }

  const rows = (head.rows ?? []).map((row) => {
    const payload = payloadOf(row);
    const currency = typeof row.currency === "string" ? row.currency : "";
    return {
      ...row,
      storeName: payload.storeName ?? "",
      entityPayload: undefined,
      currency,
      name: payload.name ?? payload.keywordText ?? payload.expression ?? payload.resolvedExpression ?? row.fallbackName ?? "",
      fallbackName: undefined,
      state: payload.state ?? null,
      servingStatus: payload.servingStatus ?? null,
      budget: payload.budget ?? payload.amount ?? null,
      strategy: payload.strategy ?? payload.policy ?? null,
      defaultBid: payload.defaultBid ?? null,
      bid: payload.bid ?? null,
      startDate: payload.startDate ?? null,
      endDate: payload.endDate ? payload.endDate : null,
      portfolioId: payload.portfolioId ?? null,
      asin: payload.asin ?? null,
      sku: payload.sku ?? null,
      matchType: payload.matchType ?? null,
      text: payload.keywordText ?? payload.expression ?? payload.resolvedExpression ?? null,
      campaignId: payload.campaignId ?? row.campaignId ?? (kind === "campaign" ? row.entityId : null),
      adGroupId: payload.groupId ?? row.adGroupId ?? (kind === "adgroup" ? row.entityId : null),
      impressions: toNumber(row.impressions),
      clicks: toNumber(row.clicks),
      cost: moneyToNumber(row.cost as { toString(): string } | null),
      adOrders: toNumber(row.adOrders),
      adSales: moneyToNumber(row.adSales as { toString(): string } | null),
      ctr: toNumber(row.ctr),
      cpc: toNumber(row.cpc),
      acos: toNumber(row.acos),
      roas: toNumber(row.roas),
      reportDates: toNumber(row.reportDates),
    } as HostRow;
  });

  // 店铺名称/站点：随行返回，避免前端再请求一次。
  const storeIds = [...new Set(rows.map((row) => String(row.storeId ?? "")).filter(Boolean))];
  if (storeIds.length) {
    const storeRows = await prisma.sellfoxStore.findMany({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, id: { in: storeIds } },
      select: { id: true, name: true, marketplace: true, externalId: true },
    });
    const map = new Map(storeRows.map((store) => [store.id, store]));
    for (const row of rows) {
      const store = map.get(String(row.storeId ?? ""));
      row.storeName = store?.name ?? "";
      row.storeMarketplace = store?.marketplace ?? "";
      row.store = [store?.name, store?.marketplace].filter(Boolean).join(" / ");
    }
  }

  const totals = (head.totals ?? []).map((bucket) => {
    const known = bucket.currency !== "";
    const values: Record<string, number | null> = {
      impressions: known ? toNumber(bucket.impressions) : null,
      clicks: known ? toNumber(bucket.clicks) : null,
      cost: known ? moneyToNumber(bucket.cost as { toString(): string } | null) : null,
      adOrders: known ? toNumber(bucket.adOrders) : null,
      adSales: known ? moneyToNumber(bucket.adSales as { toString(): string } | null) : null,
    };
    return { currency: bucket.currency || "unknown", values, entities: bucket.entities };
  });

  const derivedByCurrency = totals.map((bucket) => ({
    currency: bucket.currency,
    values: {
      ctr: ratioOf(bucket.values.clicks, bucket.values.impressions),
      cpc: ratioOf(bucket.values.cost, bucket.values.clicks),
      acos: ratioOf(bucket.values.cost, bucket.values.adSales),
      roas: ratioOf(bucket.values.adSales, bucket.values.cost),
    },
  }));

  const hasUnknownCurrency = totals.some((bucket) => bucket.currency === "unknown");
  const sumOf = (key: string) => {
    if (hasUnknownCurrency) return null;
    const known = totals.filter((bucket) => bucket.currency !== "unknown");
    if (!known.length) return null;
    return known.reduce<number | null>((total, bucket) => {
      const value = bucket.values[key];
      return total == null || value == null ? null : total + value;
    }, 0);
  };

  return {
    rows,
    total: Number(head.total ?? 0),
    totals: {
      impressions: sumOf("impressions"),
      clicks: sumOf("clicks"),
      adOrders: sumOf("adOrders"),
      byCurrency: totals.map(({ currency, values }) => ({ currency, values: { cost: values.cost, adSales: values.adSales } })),
      derivedByCurrency,
    },
    coverage: { stores: storeIds.length, rows: Number(head.total ?? 0) },
    grain: spec.grain,
    columns: spec.columns,
    facets: { states: head.states ?? [], buckets: head.buckets ?? [] },
  };
}

/** 汇总结果导出为 CSV（服务端同口径、全量筛选结果）。 */
export function adsSummaryCsv(columns: HostColumn[], rows: HostRow[]): string {
  const escape = (value: unknown) => {
    if (value == null) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.map((column) => escape(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => {
    const value = row[column.key];
    if (column.kind === "money" || column.kind === "decimal" || column.kind === "qty") {
      const parsed = toNumber(value);
      return escape(parsed == null ? "" : parsed);
    }
    if (column.kind === "rate") {
      const parsed = toNumber(value);
      return escape(parsed == null ? "" : parsed);
    }
    return escape(value);
  }).join(","));
  return [header, ...body].join("\r\n");
}
