import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import type { SyncScope } from "@/lib/amazon-sync/policy";
import { AdsQueryError, parseAdsQuery, type AdsQueryInput } from "./query-contract";
import { deriveAdsMetrics } from "./metrics";
import { publishedReportFreshness, selectReportDomainState, summarizeReportFreshness } from "./report-freshness";
import { reportCompleteness, type ReportMetricField } from "./report-completeness";

type Pair = { sellerAccountId: string; marketplaceId: string };
type Fact = { id: string; profileId: string; reportDate: Date; publishedAt: Date; syncedAt: Date; versionId: string; sourceTaskId: string; factKey: string; reportType: string; adProduct: string; apiVersion: string; currencyCode: string | null; attributionWindow: string | null; campaignId: string | null; adGroupId: string | null; targetingId: string | null; advertisedAsin: string | null; searchTerm: string | null; placement: string | null; impressions: bigint | null; clicks: bigint | null; orders: bigint | null; units: bigint | null; spend: Prisma.Decimal | null; sales: Prisma.Decimal | null };
// PostgreSQL SUM(bigint) returns numeric: a valid aggregate can exceed a row's bigint range.
type Totals = Pick<Fact, "currencyCode" | "attributionWindow" | "apiVersion" | "reportType" | "adProduct"> & Record<"impressions" | "clicks" | "orders" | "units" | "spend" | "sales", Prisma.Decimal | null> & { observedFactCount: bigint } & Record<`${ReportMetricField}ProvidedCount`, bigint>;
const sorts = new Set(["reportDate", "campaignId", "adGroupId", "impressions", "clicks", "spend", "orders", "sales", "searchTerm"]);
const nullable = (value: unknown) => value === null || value === undefined ? null : Prisma.Decimal.isDecimal(value) ? value.toFixed() : String(value);

/** One read boundary for API and MCP. Current facts, not full-report replacement semantics. */
export async function queryPublishedAdsReports(scope: SyncScope, actor: string, raw: AdsQueryInput, sourceScopes?: Pair[]) {
  // Revalidate even internal callers; SQL identifiers below are exclusively from this whitelist.
  const params = new URLSearchParams({ kind: "reports" });
  for (const [key, value] of Object.entries(raw)) if (value !== undefined && key !== "kind") params.set(key, String(value));
  const input = parseAdsQuery(params);
  if (!sorts.has(input.sortBy)) throw new AdsQueryError("报表排序无效。");
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
    const access = await amazonDataAccess(scope, actor, tx);
    const sellers = await tx.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true, displayName: true } });
    const where: Prisma.AmazonAdsProfileWhereInput = { ...scope, ...sellerAccessWhere(access), authorization: { status: "CONNECTED" },
      AND: [{ sellerAccountId: { in: sellers.map(s => s.id) } }, ...(sourceScopes ? [{ OR: sourceScopes }] : [])],
      ...(input.profileRecordId ? { id: input.profileRecordId } : {}), ...(input.sellerAccountId ? { sellerAccountId: input.sellerAccountId } : {}), ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}), ...(input.authorizationId ? { authorizationId: input.authorizationId } : {}) };
    const profiles = await tx.amazonAdsProfile.findMany({ where, take: 501, orderBy: { id: "asc" }, select: { id: true, authorizationId: true, profileId: true, sellerAccountId: true, marketplaceId: true, currencyCode: true, timezone: true, region: true, countryCode: true } });
    if (profiles.length > 500) throw new AdsQueryError("Profile 范围超过 500，请缩小筛选范围。");
    const domainStates = await tx.amazonAdsSyncDomainState.findMany({ where: { ...scope, profileId: { in: profiles.map(profile => profile.id) }, dataDomain: "reports", ...(input.reportType ? { OR: [{ reportType: input.reportType }, { reportType: "" }] } : {}) }, select: { profileId: true, reportType: true, status: true, warningCodes: true, lastAttemptAt: true, lastSuccessAt: true, lastTaskId: true } });
    const ranked = Prisma.sql`SELECT f.*, v."publishedAt", ROW_NUMBER() OVER (
      PARTITION BY f."organizationId", f."workspaceId", f."profileId", f."reportType", f."adProduct", f."reportDate", f."factKey", f."currencyCode", f."attributionWindow", f."apiVersion"
      ORDER BY v."publishedAt" DESC, v.id DESC) AS revision_rank
      FROM "AmazonAdsReportFact" f
      JOIN "AmazonAdsReportVersion" v ON v."organizationId"=f."organizationId" AND v."workspaceId"=f."workspaceId" AND v.id=f."versionId" AND v."profileId"=f."profileId" AND v."sourceTaskId"=f."sourceTaskId"
      JOIN "AmazonAdsSyncTask" t ON t."organizationId"=v."organizationId" AND t."workspaceId"=v."workspaceId" AND t.id=v."sourceTaskId" AND t."profileId"=v."profileId"
      WHERE f."organizationId"=${scope.organizationId} AND f."workspaceId"=${scope.workspaceId}
        AND f."profileId" IN (${profiles.length ? Prisma.join(profiles.map(p => p.id)) : Prisma.sql`NULL`})
        AND v.status='PUBLISHED' AND v."publishedAt" IS NOT NULL AND t.status='SUCCEEDED'
        AND f."reportDate">=${new Date(`${input.from}T00:00:00Z`)} AND f."reportDate"<=${new Date(`${input.to}T00:00:00Z`)}`;
    const filters: Prisma.Sql[] = [];
    for (const field of ["reportType", "adProduct", "campaignId", "adGroupId", "targetingId", "advertisedAsin", "searchTerm", "placement"] as const) {
      const value = input[field];
      if (value) filters.push(Prisma.sql`${Prisma.raw(`"${field}"`)}=${value}`);
    }
    if (input.search) filters.push(Prisma.sql`(POSITION(${input.search} IN COALESCE("searchTerm",''))>0 OR POSITION(${input.search} IN COALESCE("advertisedAsin",''))>0 OR POSITION(${input.search} IN COALESCE("campaignId",''))>0 OR POSITION(${input.search} IN COALESCE("adGroupId",''))>0)`);
    const selected = Prisma.sql`WITH ranked AS (${ranked}) SELECT * FROM ranked WHERE revision_rank=1 ${filters.length ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}` : Prisma.empty}`;
    const counts = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS total FROM (${selected}) current_facts`);
    const rows = await tx.$queryRaw<Fact[]>(Prisma.sql`SELECT * FROM (${selected}) current_facts ORDER BY ${Prisma.raw(`"${input.sortBy}"`)} ${Prisma.raw(input.sortDirection.toUpperCase())} NULLS LAST, "profileId", "factKey", "versionId", id LIMIT ${input.pageSize} OFFSET ${(input.page-1)*input.pageSize}`);
    const totals = await tx.$queryRaw<Totals[]>(Prisma.sql`SELECT "currencyCode", "attributionWindow", "apiVersion", "reportType", "adProduct", CASE WHEN COUNT(impressions) = COUNT(*) THEN SUM(impressions) ELSE NULL END AS impressions, CASE WHEN COUNT(clicks) = COUNT(*) THEN SUM(clicks) ELSE NULL END AS clicks, CASE WHEN COUNT(orders) = COUNT(*) THEN SUM(orders) ELSE NULL END AS orders, CASE WHEN COUNT(units) = COUNT(*) THEN SUM(units) ELSE NULL END AS units, CASE WHEN COUNT(spend) = COUNT(*) THEN SUM(spend) ELSE NULL END AS spend, CASE WHEN COUNT(sales) = COUNT(*) THEN SUM(sales) ELSE NULL END AS sales, COUNT(*) AS "observedFactCount", COUNT(impressions) AS "impressionsProvidedCount", COUNT(clicks) AS "clicksProvidedCount", COUNT(orders) AS "ordersProvidedCount", COUNT(units) AS "unitsProvidedCount", COUNT(spend) AS "spendProvidedCount", COUNT(sales) AS "salesProvidedCount" FROM (${selected}) current_facts GROUP BY "currencyCode", "attributionWindow", "apiVersion", "reportType", "adProduct"`);
    const observed = await tx.$queryRaw<Array<{ profileId: string; lastSuccessAt: Date; coveredFrom: Date; coveredTo: Date }>>(Prisma.sql`SELECT "profileId", MAX("publishedAt") AS "lastSuccessAt", MIN("reportDate") AS "coveredFrom", MAX("reportDate") AS "coveredTo" FROM (${selected}) current_facts GROUP BY "profileId"`);
    const observedByProfile = new Map(observed.map(row => [row.profileId, row]));
    const freshProfiles = profiles.map(profile => {
      const row = observedByProfile.get(profile.id);
      const state = selectReportDomainState(domainStates, profile.id, input.reportType);
      const freshness = publishedReportFreshness(!!row, state?.status);
      return { profileRecordId: profile.id, status: freshness, reportType: input.reportType ?? null, dataDomain: "reports", coveredFrom: row?.coveredFrom.toISOString().slice(0, 10) ?? null, coveredTo: row?.coveredTo.toISOString().slice(0, 10) ?? null, lastSuccessAt: row?.lastSuccessAt.toISOString() ?? null, lastAttemptAt: state?.lastAttemptAt?.toISOString() ?? null, lastTaskId: state?.lastTaskId ?? null, warningCodes: state?.warningCodes ?? [] };
    });
    const dates = observed.map(f => f.lastSuccessAt.getTime());
    const freshnessStatus = summarizeReportFreshness(freshProfiles.map(profile => profile.status));
    return { profiles, rows, totals, freshProfiles, freshnessStatus, observed, lastSyncAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null, total: Number(counts[0].total) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
  // Recheck permissions, activity, connection and exact bindings outside the read snapshot.
  const access = await amazonDataAccess(scope, actor);
  const sellers = await prisma.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true } });
  if (result.profiles.length && await prisma.amazonAdsProfile.count({ where: { ...scope, ...sellerAccessWhere(access), authorization: { status: "CONNECTED" }, AND: [{ sellerAccountId: { in: sellers.map(s => s.id) } }, { OR: result.profiles.map(p => ({ id: p.id, authorizationId: p.authorizationId, profileId: p.profileId, sellerAccountId: p.sellerAccountId, marketplaceId: p.marketplaceId })) }] } }) !== result.profiles.length) throw new AdsQueryError("Ads 数据范围已变化。", 403);
  const profileMap = new Map(result.profiles.map(p => [p.id, p]));
  const rows = result.rows.map(row => ({
    id: row.id, reportType: row.reportType, adProduct: row.adProduct, factKey: row.factKey,
    campaignId: row.campaignId, adGroupId: row.adGroupId, targetingId: row.targetingId,
    advertisedAsin: row.advertisedAsin, searchTerm: row.searchTerm, placement: row.placement,
    currencyCode: row.currencyCode, attributionWindow: row.attributionWindow, apiVersion: row.apiVersion,
    sourceTaskId: row.sourceTaskId, versionId: row.versionId,
    impressions: nullable(row.impressions), clicks: nullable(row.clicks), spend: nullable(row.spend),
    orders: nullable(row.orders), sales: nullable(row.sales), units: nullable(row.units),
    ...deriveAdsMetrics(row),
    profileId: row.profileId, internalProfileId: row.profileId, amazonProfileId: profileMap.get(row.profileId)?.profileId,
    sellerAccountId: profileMap.get(row.profileId)?.sellerAccountId, marketplaceId: profileMap.get(row.profileId)?.marketplaceId,
    reportDate: row.reportDate.toISOString().slice(0,10), syncedAt: row.syncedAt.toISOString(), publishedAt: row.publishedAt.toISOString(),
    versionStatus: "PUBLISHED", sourceTaskStatus: "SUCCEEDED",
  }));
  const freshProfiles = result.freshProfiles;
  const page = { page: input.page, pageSize: input.pageSize, total: result.total, hasMore: input.page*input.pageSize < result.total, hasNext: input.page*input.pageSize < result.total, pageCount: Math.ceil(result.total/input.pageSize) };
  await auditAmazonDataRead(scope, actor, "amazon-ads-reports");
  const totals = result.totals.map(row => ({ currencyCode: row.currencyCode, attributionWindow: row.attributionWindow, apiVersion: row.apiVersion, reportType: row.reportType, adProduct: row.adProduct, impressions: nullable(row.impressions), clicks: nullable(row.clicks), spend: nullable(row.spend), orders: nullable(row.orders), sales: nullable(row.sales), units: nullable(row.units), ...deriveAdsMetrics(row), completeness: reportCompleteness(row.observedFactCount, { impressions: row.impressionsProvidedCount, clicks: row.clicksProvidedCount, orders: row.ordersProvidedCount, units: row.unitsProvidedCount, spend: row.spendProvidedCount, sales: row.salesProvidedCount }) }));
  const publishedVersionIds = [...new Set(result.rows.map(row => row.versionId))];
  return { rows, data: rows, total: result.total, page: input.page, pageSize: input.pageSize, pagination: page, dateRange: { from: input.from, to: input.to }, source: "AmazonAdsReportFact", syncedAt: result.lastSyncAt,
    totals,
    freshness: { status: result.freshnessStatus, profiles: freshProfiles },
    meta: { source: "AmazonAdsReportFact", isDemo: false, isSandbox: false, dataDomain: "REPORTS", page, dateRange: { from: input.from, to: input.to }, lastSyncAt: result.lastSyncAt, coverage: "LATEST_PUBLISHED_OBSERVED_FACTS", freshness: result.freshnessStatus, dataIntegrity: result.total ? "PUBLISHED_VERSION_FACTS_ONLY" : "NO_PUBLISHED_FACTS", schemaStatus: "application_schema_confirmed_source_sample_pending", profilesTruncated: false, profiles: result.profiles.map(p => ({ ...p, amazonProfileId: p.profileId, internalProfileId: p.id, freshness: result.freshProfiles.find(state => state.profileRecordId === p.id)?.status ?? "MISSING", syncPlans: [] })), publishedVersionIds, currency: "per_row", attributionWindow: "per_row", metricCompletenessBasis: "CURRENT_OBSERVED_FACTS", grain: ["profileId", "reportType", "adProduct", "reportDate", "factKey", "currencyCode", "attributionWindow", "apiVersion"], fieldDefinitions: { profileId: "ERP 内部 Profile ID", amazonProfileId: "Amazon 外部 Profile ID", sellerAccountId: "ERP 店铺 ID", marketplaceId: "ERP 站点 ID", reportDate: "报告源时区的日期标签", versionId: "已发布版本 ID", publishedAt: "此版本本地发布时间", spend: "原币种十进制字符串；null 表示未提供", attributionWindow: "来源归因窗口；null 表示未知", apiVersion: "来源 API 合同版本", ctr: "clicks / impressions × 100（百分比点）", cpc: "spend / clicks", cvr: "orders / clicks × 100（百分比点）", acos: "spend / sales × 100（百分比点）", roas: "sales / spend" } },
    warnings: ["本地已发布快照，不是实时 Amazon API；具体官方报表和真实样本仍待验收。", "仅按已观察事实键修订，不将空报告或缺失行推定为删除；不证明日期完整或归因已最终回补。", "金额汇总按币种、报告类型、广告产品、API 和归因口径分组；未知口径不可用于绩效比较。", "报告时效未采用结构同步频率；OBSERVED_PUBLISHED仅表示当前范围存在已发布事实，没有报告专属时效合同就不判定CURRENT。", "同组任一已观察事实缺失某项指标时，该项汇总及依赖它的派生指标为 null；完整性仅限已保存事实，不证明日期覆盖完整。"] };
}
