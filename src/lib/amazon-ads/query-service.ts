import { queryPublishedAdsReports } from "./report-query";
import { Prisma, type AmazonAdsEntityRecord } from "@prisma/client";
import { amazonDataAccess, type AmazonDataAccess } from "@/lib/amazon-sync/data-access";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { prisma } from "@/lib/db/prisma";
import type { SyncScope } from "@/lib/amazon-sync/policy";
import { AdsQueryError, type AdsQueryInput } from "./query-contract";
import { amazonAdsRepository, createAmazonAdsRepository, type AdsProfileRecord, type AdsProfileWhere } from "./repository";

type EntitySource = { id: string; status: string; stage?: string; finishedAt: Date | null };
export type AdsEntityQueryRow = Pick<AmazonAdsEntityRecord,
  "id" | "profileId" | "entityType" | "externalId" | "parentExternalId" | "state" | "name" | "adProduct" | "campaignId" | "adGroupId" |
  "startDate" | "endDate" | "targetingType" | "budgetAmount" | "budgetType" | "bid" | "keywordText" | "matchType" |
  "expressionType" | "targetingExpression" | "payload" | "sourceUpdatedAt" | "syncedAt" | "sourceTaskId"> & { sourceTask: EntitySource };
export type AdsFreshnessRow = {
  profileId: string; dataDomain: string; reportType: string; status: string;
  coveredFrom: Date | null; coveredTo: Date | null; lastAttemptAt: Date | null; lastSuccessAt: Date | null;
  warningCodes: string[]; lastTaskId: string | null;
};
export interface AdsQueryRepository {
  listProfiles(scope: SyncScope, where: AdsProfileWhere): Promise<AdsProfileRecord[]>;
  countEntities(where: Prisma.AmazonAdsEntityRecordWhereInput): Promise<number>;
  listEntities(where: Prisma.AmazonAdsEntityRecordWhereInput, input: { skip: number; take: number; orderBy: Prisma.AmazonAdsEntityRecordOrderByWithRelationInput[] }): Promise<AdsEntityQueryRow[]>;
  listFreshness(scope: SyncScope, profileIds: string[], dataDomain: string, reportType?: string): Promise<AdsFreshnessRow[]>;
}

export interface AdsQueryServiceDependencies {
  repository: AdsQueryRepository;
  resolveAccess(scope: SyncScope, actor: string): Promise<AmazonDataAccess>;
  audit(scope: SyncScope, actor: string, kind: AdsQueryInput["kind"]): Promise<void>;
  readSnapshot?<T>(read: (dependencies: Pick<AdsQueryServiceDependencies, "repository" | "resolveAccess">) => Promise<T>): Promise<T>;
}

/** Shared by the production read and isolated concurrency tests; no writes or external calls. */
export async function withAdsQueryReadSnapshot<T>(read: (dependencies: Pick<AdsQueryServiceDependencies, "repository" | "resolveAccess">) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
    return read({ repository: createAmazonAdsRepository(tx), resolveAccess: (scope, actor) => amazonDataAccess(scope, actor, tx, "view") });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
}

const defaultDependencies: AdsQueryServiceDependencies = {
  repository: amazonAdsRepository,
  resolveAccess: (scope, actor) => amazonDataAccess(scope, actor, prisma, "view"),
  audit: (scope, actor, kind) => auditAmazonDataRead(scope, actor, `amazon-ads-${kind}`),
  readSnapshot: withAdsQueryReadSnapshot,
};

export function buildAdsProfileWhere(scope: SyncScope, access: AmazonDataAccess, input: Pick<AdsQueryInput, "profileRecordId" | "sellerAccountId" | "authorizationId" | "marketplaceId">): Prisma.AmazonAdsProfileWhereInput {
  const and: Prisma.AmazonAdsProfileWhereInput[] = [
    { organizationId: scope.organizationId },
    { workspaceId: scope.workspaceId },
  ];

  if (!access.allSellers) {
    if (access.scopes) {
      and.push(access.scopes.length ? {
        OR: access.scopes.map((authorized) => ({
          sellerAccountId: authorized.sellerAccountId,
          ...(authorized.marketplaceIds.length ? { marketplaceId: { in: authorized.marketplaceIds } } : {}),
        })),
      } : { id: { in: [] } });
    } else {
      and.push(access.sellerIds.length ? { sellerAccountId: { in: access.sellerIds } } : { id: { in: [] } });
    }
  }

  if (input.profileRecordId) and.push({ id: input.profileRecordId });
  if (input.sellerAccountId) and.push({ sellerAccountId: input.sellerAccountId });
  if (input.authorizationId) and.push({ authorizationId: input.authorizationId });
  if (input.marketplaceId) and.push({ marketplaceId: input.marketplaceId });
  return { AND: and };
}

export function buildAdsEntityWhere(scope: SyncScope, profileWhere: AdsProfileWhere, input: AdsQueryInput): Prisma.AmazonAdsEntityRecordWhereInput {
  const and: Prisma.AmazonAdsEntityRecordWhereInput[] = [
    { organizationId: scope.organizationId },
    { workspaceId: scope.workspaceId },
    { profile: { is: profileWhere } },
  ];
  if (input.entityType) and.push({ entityType: input.entityType });
  if (input.state) and.push({ state: input.state });
  if (input.campaignId) and.push({
    OR: [
      { campaignId: input.campaignId },
      // Only Ad Groups and campaign-level negatives have a Campaign as direct parent.
      { campaignId: null, parentExternalId: input.campaignId, OR: [{ entityType: { endsWith: ":ad-group" } }, { entityType: { contains: ":campaign-negative-" } }] },
      { externalId: input.campaignId, entityType: { endsWith: "campaign" } },
      { campaignId: null, payload: { path: ["campaignId"], equals: input.campaignId } },
    ],
  });
  if (input.adGroupId) and.push({
    OR: [
      { adGroupId: input.adGroupId },
      { externalId: input.adGroupId, entityType: { endsWith: "ad-group" } },
      { adGroupId: null, payload: { path: ["adGroupId"], equals: input.adGroupId } },
    ],
  });
  if (input.externalId) and.push({ externalId: input.externalId });
  if (input.search) and.push({
    OR: [
      { name: { contains: input.search, mode: "insensitive" } },
      { keywordText: { contains: input.search, mode: "insensitive" } },
      { externalId: { contains: input.search } },
      { name: null, payload: { path: ["name"], string_contains: input.search } },
      { keywordText: null, payload: { path: ["keywordText"], string_contains: input.search } },
    ],
  });
  return { AND: and };
}

export function entityOrderBy(sortBy: string, direction: "asc" | "desc"): Prisma.AmazonAdsEntityRecordOrderByWithRelationInput[] {
  return [{ [sortBy]: direction } as Prisma.AmazonAdsEntityRecordOrderByWithRelationInput, { id: "asc" }];
}

export async function queryAmazonAdsData(
  scope: SyncScope,
  actor: string,
  input: AdsQueryInput,
  dependencies: AdsQueryServiceDependencies = defaultDependencies,
) {
  if (input.kind === "reports") return queryPublishedAdsReports(scope, actor, input);
  if (input.kind === "entities") {
    const read = async (reader: Pick<AdsQueryServiceDependencies, "repository" | "resolveAccess">) => {
      const access = await reader.resolveAccess(scope, actor);
      const initialProfileWhere = buildAdsProfileWhere(scope, access, input);
      const profiles = (await reader.repository.listProfiles(scope, initialProfileWhere)).filter(profile => profile.authorization.status === "CONNECTED" && profile.seller);
      const profileWhere: AdsProfileWhere = { AND: [initialProfileWhere, { id: { in: profiles.map(profile => profile.id) } }] };
      if (input.profileRecordId && !profiles.length) throw new AdsQueryError("请求的 Ads Profile 不在当前授权范围内。", 403);
      if (input.marketplaceId && !profiles.length) throw new AdsQueryError("请求的 Marketplace 不在当前授权范围内。", 403);
      const profileRecordIds = profiles.map(profile => profile.id);
      const where = buildAdsEntityWhere(scope, profileWhere, input);
      const [data, total, freshness] = await Promise.all([
        reader.repository.listEntities(where, { skip: (input.page - 1) * input.pageSize, take: input.pageSize, orderBy: entityOrderBy(input.sortBy, input.sortDirection) }),
        reader.repository.countEntities(where),
        // The worker publishes one state for the eight-collection structure domain.
        reader.repository.listFreshness(scope, profileRecordIds, "entities"),
      ]);
      return { profiles, profileRecordIds, data, total, freshness };
    };
    const { profiles, profileRecordIds, data, total, freshness } = await (dependencies.readSnapshot ? dependencies.readSnapshot(read) : read(dependencies));
    // Do not release rows, counts or metadata using grants/bindings read before the query.
    const currentAccess = await dependencies.resolveAccess(scope, actor);
    if (profiles.length) {
      const currentProfiles = (await dependencies.repository.listProfiles(scope, {
        AND: [buildAdsProfileWhere(scope, currentAccess, input), { id: { in: profileRecordIds } }],
      })).filter(profile => profile.authorization.status === "CONNECTED" && profile.seller);
      const byId = new Map(currentProfiles.map(profile => [profile.id, profile]));
      if (profiles.some(profile => {
        const current = byId.get(profile.id);
        return !current || current.authorizationId !== profile.authorizationId || current.profileId !== profile.profileId
          || current.sellerAccountId !== profile.sellerAccountId || current.marketplaceId !== profile.marketplaceId
          || current.currencyCode !== profile.currencyCode || current.timezone !== profile.timezone;
      })) throw new AdsQueryError("Ads 数据范围已变化，请重新查询。", 403);
    }
    await dependencies.audit(scope, actor, input.kind);
    const warnings = freshnessWarnings(freshness, data.length === 0 && total === 0);
    return {
      data: data.map((row) => ({ ...serializeEntity(row), amazonProfileId: profiles.find(profile => profile.id === row.profileId)?.profileId })),
      rows: data.map((row) => ({ ...serializeEntity(row), amazonProfileId: profiles.find(profile => profile.id === row.profileId)?.profileId })),
      total,
      page: input.page,
      pageSize: input.pageSize,
      pagination: pagination(input, total),
      scope: { profileRecordIds, profiles: profiles.map(serializeProfile), marketplaceId: input.marketplaceId ?? null },
      meta: legacyMeta(profiles, freshness),
      dateRange: null,
      source: "amazon_ads_postgres",
      syncedAt: latestDate(freshness.map((row) => row.lastSuccessAt))?.toISOString() ?? null,
      freshness: freshnessEnvelope(freshness, profileRecordIds),
      totals: null,
      warnings,
    };
  }

  throw new AdsQueryError("Ads 数据类型无效。");
}

function serializeEntity(row: AdsEntityQueryRow) {
  return {
    id: row.id, profileId: row.profileId, internalProfileId: row.profileId, sourceTask: { status: row.sourceTask.status, stage: row.sourceTask.stage ?? "UNKNOWN" }, entityType: row.entityType, externalId: row.externalId, parentExternalId: row.parentExternalId,
    state: row.state, name: row.name, adProduct: row.adProduct, campaignId: row.campaignId, adGroupId: row.adGroupId,
    startDate: row.startDate?.toISOString().slice(0, 10) ?? null, endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
    targetingType: row.targetingType, budgetAmount: row.budgetAmount?.toString() ?? null, budgetType: row.budgetType,
    bid: row.bid?.toString() ?? null, keywordText: row.keywordText, matchType: row.matchType, expressionType: row.expressionType,
    targetingExpression: row.targetingExpression, payload: row.payload, sourceTaskId: row.sourceTaskId,
    sourceTaskStatus: row.sourceTask.status, sourceTaskFinishedAt: row.sourceTask.finishedAt?.toISOString() ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null, syncedAt: row.syncedAt.toISOString(),
  };
}

function serializeProfile(profile: AdsProfileRecord) {
  return {
    profileRecordId: profile.id, amazonProfileId: profile.profileId, region: profile.region,
    countryCode: profile.countryCode, marketplaceId: profile.marketplaceId, currencyCode: profile.currencyCode,
    timezone: profile.timezone, sellerAccountId: profile.sellerAccountId, sellerName: profile.seller?.displayName ?? null,
    authorizationId: profile.authorizationId, authorizationName: profile.authorization.name, authorizationStatus: profile.authorization.status,
    syncPlans: profile.syncPlans,
  };
}

function legacyMeta(profiles: AdsProfileRecord[], freshness: AdsFreshnessRow[]) {
  const lastSyncAt = latestDate(freshness.map((row) => row.lastSuccessAt));
  return {
    lastSyncAt: lastSyncAt?.toISOString() ?? null,
    source: "amazon_ads_postgres",
    coverage: freshnessEnvelope(freshness, profiles.map(profile => profile.id)).status,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      amazonProfileId: profile.profileId,
      authorizationId: profile.authorizationId,
      sellerAccountId: profile.sellerAccountId,
      seller: profile.seller,
      timezone: profile.timezone,
      currencyCode: profile.currencyCode,
      freshness: freshnessEnvelope(freshness.filter(row => row.profileId === profile.id), [profile.id]).status,
      syncPlans: profile.syncPlans,
    })),
    profilesTruncated: false,
  };
}

function pagination(input: AdsQueryInput, total: number) {
  return { page: input.page, pageSize: input.pageSize, total, pageCount: Math.ceil(total / input.pageSize), hasMore: input.page * input.pageSize < total };
}

export function freshnessEnvelope(rows: AdsFreshnessRow[], profileIds: string[]) {
  const byProfile = rows.map((row) => ({
    profileRecordId: row.profileId, dataDomain: row.dataDomain, reportType: row.reportType || null,
    status: row.status, coveredFrom: row.coveredFrom?.toISOString().slice(0, 10) ?? null,
    coveredTo: row.coveredTo?.toISOString().slice(0, 10) ?? null,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastTaskId: row.lastTaskId, warningCodes: row.warningCodes,
  }));
  if (!rows.length) return { status: "UNKNOWN", profiles: byProfile };
  if (rows.some((row) => ["FAILED", "BLOCKED"].includes(row.status))) return { status: "FAILED", profiles: byProfile };
  if (rows.some((row) => ["SYNCING", "RUNNING", "QUEUED", "WAITING", "RETRY_WAIT", "WAITING_FOR_ADAPTER", "WAITING_FOR_CONFIG"].includes(row.status))) return { status: "SYNCING", profiles: byProfile };
  if (rows.some((row) => ["PARTIAL", "STALE", "CANCELLED"].includes(row.status))) return { status: "PARTIAL", profiles: byProfile };
  const covered = new Set(rows.filter(row => row.status === "CURRENT").map(row => row.profileId));
  if (rows.every(row => row.status === "CURRENT") && profileIds.every(id => covered.has(id))) return { status: "CURRENT", profiles: byProfile };
  return { status: covered.size ? "PARTIAL" : "UNKNOWN", profiles: byProfile };
}

function freshnessWarnings(rows: AdsFreshnessRow[], noRows: boolean) {
  const warnings: string[] = [];
  if (!rows.length) warnings.push("当前范围尚无此数据域的新鲜度记录。");
  if (rows.some((row) => row.warningCodes.length)) warnings.push("同步记录包含数据质量或覆盖范围提示，请查看来源任务。");
  if (noRows) warnings.push("当前筛选范围没有已保存的 Amazon Ads 数据；这不代表 Amazon 账户中没有数据。");
  return warnings;
}

function latestDate(values: Array<Date | null>) {
  const dates = values.filter((value): value is Date => value !== null);
  return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : null;
}
