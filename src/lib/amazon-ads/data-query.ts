import { amazonAdsAccountReadAccess } from "./read-access";
import { amazonBusinessData } from "@/lib/amazon-sync/business-data";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import type { AdsAuthScope } from "./authorization";
import { buildAdsEntityWhere, freshnessEnvelope } from "./query-service";
import { createAmazonAdsRepository } from "./repository";
import { assertUnambiguousAdsParams, AdsQueryError } from "./query-contract";

const sortFields = ["entityType", "externalId", "state", "syncedAt", "sourceUpdatedAt"] as const;
export function parseAdsEntityQuery(params: URLSearchParams) {
  try { assertUnambiguousAdsParams(params); }
  catch (error) { if (error instanceof AdsQueryError) throw new SyncInputError(error.message, error.status); throw error; }
  const text = (key: string) => {
    const value = params.get(key)?.trim();
    if (value && value.length > 200) throw new SyncInputError("Ads 筛选参数过长。");
    return value || undefined;
  };
  const integer = (key: string, fallback: number, max: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) throw new SyncInputError("Ads 分页参数无效。");
    return value;
  };
  const sort = text("sort") ?? "entityType", direction = text("direction") ?? "asc";
  if (!sortFields.includes(sort as typeof sortFields[number]) || !["asc", "desc"].includes(direction)) throw new SyncInputError("Ads 排序参数无效。");
  const internalProfileId = text("internalProfileId"), legacyProfileId = text("profileId");
  if (internalProfileId && legacyProfileId && internalProfileId !== legacyProfileId) throw new SyncInputError("Profile 参数冲突。");
  if (params.has("from") || params.has("to")) throw new SyncInputError("结构数据没有报告日期维度，请切换日报事实。");
  return { page: integer("page", 1, 10000), pageSize: integer("pageSize", 50, 100), sort, direction: direction as "asc" | "desc", internalProfileId: internalProfileId ?? legacyProfileId,
    sellerAccountId: text("sellerAccountId"), authorizationId: text("authorizationId"), entityType: text("entityType"), campaignId: text("campaignId"), adGroupId: text("adGroupId"), externalId: text("externalId"), state: text("state"), search: text("search") };
}

/** Shared scoped read boundary. Never loads credentials or contacts Amazon. */
export async function queryAdsEntities(scope: AdsAuthScope, actor: string, params: URLSearchParams, sourceScopes?: Array<{ sellerAccountId: string; marketplaceId: string }>) {
  const query = parseAdsEntityQuery(params);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
    const access = await amazonAdsAccountReadAccess(scope, actor, query, tx);
    const sellers = await tx.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true, displayName: true } });
    const profileWhere: Prisma.AmazonAdsProfileWhereInput = { ...scope, ...sellerAccessWhere(access), AND: [{ sellerAccountId: { in: sellers.map(seller => seller.id) } }, ...(sourceScopes ? [{ OR: sourceScopes }] : [])], authorization: { status: "CONNECTED" },
      ...(query.internalProfileId ? { id: query.internalProfileId } : {}), ...(query.sellerAccountId ? { sellerAccountId: query.sellerAccountId } : {}), ...(query.authorizationId ? { authorizationId: query.authorizationId } : {}) };
    const where = buildAdsEntityWhere(scope, profileWhere, { ...query, kind: "entities", sortBy: query.sort, sortDirection: query.direction });
    const [total, rows, aggregate, profiles] = await Promise.all([
      tx.amazonAdsEntityRecord.count({ where }),
      tx.amazonAdsEntityRecord.findMany({ where, orderBy: [{ [query.sort]: query.direction }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        include: { profile: { select: { profileId: true, authorizationId: true, region: true, timezone: true, currencyCode: true, sellerAccountId: true, marketplaceId: true } }, sourceTask: { select: { status: true, stage: true } } } }),
      tx.amazonAdsEntityRecord.aggregate({ where, _max: { syncedAt: true } }),
      tx.amazonAdsProfile.findMany({ where: profileWhere, orderBy: { id: "asc" }, take: 501, select: { id: true, profileId: true, authorizationId: true, region: true, countryCode: true, currencyCode: true, timezone: true, sellerAccountId: true, marketplaceId: true,
        authorization: { select: { name: true, status: true } }, syncPlans: { select: { id: true, status: true, intervalMinutes: true, lastSuccessAt: true, lastErrorCode: true, tasks: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, status: true, stage: true, processedCount: true, apiRequests: true, errorCode: true, createdAt: true, finishedAt: true } } } } } }),
    ]);
    if (profiles.length > 500) throw new SyncInputError("Ads Profile 范围超过 500，请缩小筛选范围。");
    const states = await createAmazonAdsRepository(tx).listFreshness(scope, profiles.map(profile => profile.id), "entities");
    const freshness = freshnessEnvelope(states, profiles.map(profile => profile.id));
    return { rows: rows.map(row => ({ ...row, payload: amazonBusinessData(row.payload), internalProfileId: row.profileId, amazonProfileId: row.profile.profileId, apiVersion: row.sourceTask.stage === "COMPLETED_SP_STRUCTURE" ? "sp-v3" : null })), total, page: query.page, pageSize: query.pageSize,
      meta: { source: "AmazonAdsEntityRecord", isDemo: false, dataDomain: "SP_STRUCTURE", dateWindow: null, lastSyncAt: aggregate._max.syncedAt, profilesTruncated: false,
        coverage: freshness.status, freshness, profiles: profiles.map(profile => ({ ...profile, seller: sellers.find(seller => seller.id === profile.sellerAccountId), internalProfileId: profile.id, amazonProfileId: profile.profileId,
          freshness: freshnessEnvelope(states.filter(state => state.profileId === profile.id), [profile.id]).status })) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
}
