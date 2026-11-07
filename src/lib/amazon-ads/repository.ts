import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type AdsProfileWhere = Prisma.AmazonAdsProfileWhereInput;
export type AdsProfileRecord = {
  id: string;
  authorizationId: string;
  profileId: string;
  region: string;
  countryCode: string;
  marketplaceId: string | null;
  currencyCode: string | null;
  timezone: string | null;
  sellerAccountId: string | null;
  authorization: { id: string; name: string; status: string };
  seller: { displayName: string } | null;
  syncPlans: Array<{ id: string; status: string; lastSuccessAt: Date | null; lastErrorCode: string | null; tasks: Array<{ id: string; status: string; stage: string; errorCode: string | null; processedCount: number }> }>;
};

export function createAmazonAdsRepository(db: Prisma.TransactionClient | typeof prisma = prisma) {
  return {
    async listProfiles(scope: { organizationId: string; workspaceId: string }, where: AdsProfileWhere): Promise<AdsProfileRecord[]> {
      const rows = await db.amazonAdsProfile.findMany({
        where,
        orderBy: [{ countryCode: "asc" }, { profileId: "asc" }],
        take: 1001,
        select: {
          id: true,
          authorizationId: true,
          profileId: true,
          region: true,
          countryCode: true,
          marketplaceId: true,
          currencyCode: true,
          timezone: true,
          sellerAccountId: true,
          authorization: { select: { id: true, name: true, status: true } },
          syncPlans: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              lastSuccessAt: true,
              lastErrorCode: true,
              tasks: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, status: true, stage: true, errorCode: true, processedCount: true } },
            },
          },
        },
      });
      if (rows.length > 1000) throw new Error("Ads Profile 范围超过 1000，请缩小范围。");
      const sellerIds = [...new Set(rows.flatMap((row) => row.sellerAccountId ? [row.sellerAccountId] : []))];
      const sellers = sellerIds.length ? await db.sellerAccount.findMany({ where: { ...scope, id: { in: sellerIds }, status: "active" }, select: { id: true, displayName: true } }) : [];
      const sellerById = new Map(sellers.map((seller) => [seller.id, { displayName: seller.displayName }]));
      return rows.slice(0, 1000).map((row) => ({ ...row, seller: row.sellerAccountId ? sellerById.get(row.sellerAccountId) ?? null : null }));
    },

    async countEntities(where: Prisma.AmazonAdsEntityRecordWhereInput) {
      return db.amazonAdsEntityRecord.count({ where });
    },

    async listEntities(where: Prisma.AmazonAdsEntityRecordWhereInput, input: { skip: number; take: number; orderBy: Prisma.AmazonAdsEntityRecordOrderByWithRelationInput[] }) {
      return db.amazonAdsEntityRecord.findMany({
        where,
        skip: input.skip,
        take: input.take,
        orderBy: input.orderBy,
        include: {
          sourceTask: { select: { id: true, status: true, stage: true, finishedAt: true } },
        },
      });
    },

    async listFreshness(scope: { organizationId: string; workspaceId: string }, profileIds: string[], dataDomain: string, reportType?: string) {
      if (!profileIds.length) return [];
      const persisted = await db.amazonAdsSyncDomainState.findMany({
        where: {
          ...scope,
          profileId: { in: profileIds },
          dataDomain,
          ...(reportType ? { reportType } : {}),
        },
        orderBy: [{ lastSuccessAt: "desc" }, { updatedAt: "desc" }],
        select: { profileId: true, dataDomain: true, reportType: true, status: true, coveredFrom: true, coveredTo: true, lastAttemptAt: true, lastSuccessAt: true, warningCodes: true, lastTaskId: true },
      });
      if (dataDomain !== "entities") return persisted;
      const found = new Set(persisted.map((row) => `${row.profileId}:${row.reportType}`));
      const missing = profileIds.filter((profileId) => !found.has(`${profileId}:${reportType ?? ""}`));
      if (!missing.length) return persisted;
      const fallback = await Promise.all(missing.map(async (profileId) => {
        if (dataDomain === "entities") {
          const row = await db.amazonAdsEntityRecord.findFirst({ where: { ...scope, profileId }, orderBy: { syncedAt: "desc" }, select: { syncedAt: true, sourceTaskId: true, sourceTask: { select: { status: true, stage: true, finishedAt: true } } } });
          const completed = row?.sourceTask.status === "SUCCEEDED" && row.sourceTask.stage === "COMPLETED_SP_STRUCTURE";
          return row ? { profileId, dataDomain, reportType: "", status: completed ? "CURRENT" : row.sourceTask.status === "SUCCEEDED" ? "UNKNOWN" : row.sourceTask.status, coveredFrom: null, coveredTo: null, lastAttemptAt: row.syncedAt, lastSuccessAt: completed ? row.sourceTask.finishedAt ?? row.syncedAt : null, warningCodes: ["ENTITY_FRESHNESS_FROM_SNAPSHOT"], lastTaskId: row.sourceTaskId } : null;
        }
        return null;
      }));
      return [...persisted, ...fallback.filter((row): row is NonNullable<typeof row> => row !== null)];
    },

    async recordSyncAttempt(input: {
      organizationId: string; workspaceId: string; profileId: string; taskId: string; attemptNumber: number;
      stage: string; status: string; startedAt?: Date; finishedAt?: Date; retryAt?: Date; errorCode?: string;
      safeErrorSummary?: string; apiRequests?: number; processedCount?: number;
    }) {
      return db.amazonAdsSyncAttempt.upsert({
        where: { organizationId_workspaceId_taskId_attemptNumber: { organizationId: input.organizationId, workspaceId: input.workspaceId, taskId: input.taskId, attemptNumber: input.attemptNumber } },
        create: { id: randomUUID(), ...input },
        update: { stage: input.stage, status: input.status, finishedAt: input.finishedAt ?? null, retryAt: input.retryAt ?? null, errorCode: input.errorCode ?? null, safeErrorSummary: input.safeErrorSummary ?? null, apiRequests: input.apiRequests ?? 0, processedCount: input.processedCount ?? 0 },
      });
    },

    async upsertDomainState(input: {
      organizationId: string; workspaceId: string; profileId: string; dataDomain: string; reportType?: string;
      status: string; coveredFrom?: Date | null; coveredTo?: Date | null; lastAttemptAt?: Date | null;
      lastSuccessAt?: Date | null; lastTaskId?: string | null; warningCodes?: string[];
    }) {
      const reportType = input.reportType ?? "";
      const unique = { organizationId: input.organizationId, workspaceId: input.workspaceId, profileId: input.profileId, dataDomain: input.dataDomain, reportType };
      const data = {
        status: input.status,
        coveredFrom: input.coveredFrom ?? null,
        coveredTo: input.coveredTo ?? null,
        lastAttemptAt: input.lastAttemptAt ?? null,
        lastSuccessAt: input.lastSuccessAt ?? null,
        lastTaskId: input.lastTaskId ?? null,
        warningCodes: input.warningCodes ?? [],
      };
      return db.amazonAdsSyncDomainState.upsert({
        where: { organizationId_workspaceId_profileId_dataDomain_reportType: unique },
        create: { id: randomUUID(), ...unique, ...data },
        update: data,
      });
    },

    async upsertReportDocument(input: {
      organizationId: string; workspaceId: string; profileId: string; requestId: string; partIndex: number;
      format?: string | null; compression?: string | null; status: string; storageFileId?: string | null;
      contentSha256?: string | null; byteSize?: bigint | null; rowCount?: number | null; downloadedAt?: Date | null;
    }) {
      if (input.storageFileId) {
        const storedFile = await db.fileObject.findFirst({
          where: { id: input.storageFileId, organizationId: input.organizationId, workspaceId: input.workspaceId },
          select: { id: true },
        });
        if (!storedFile) throw new Error("Amazon Ads 报表文件不属于当前组织和工作区。");
      }
      const unique = { organizationId: input.organizationId, workspaceId: input.workspaceId, requestId: input.requestId, partIndex: input.partIndex };
      return db.amazonAdsReportDocument.upsert({
        where: { organizationId_workspaceId_requestId_partIndex: unique },
        create: { id: randomUUID(), ...input },
        update: { format: input.format ?? null, compression: input.compression ?? null, status: input.status, storageFileId: input.storageFileId ?? null, contentSha256: input.contentSha256 ?? null, byteSize: input.byteSize ?? null, rowCount: input.rowCount ?? null, downloadedAt: input.downloadedAt ?? null },
      });
    },

    async createReportRequest(input: {
      organizationId: string; workspaceId: string; profileId: string; sourceTaskId: string; versionId?: string | null;
      idempotencyKey: string; apiVersion: string; reportType: string; adProduct: string; requestedFrom: Date;
      requestedTo: Date; requestOptions: Prisma.InputJsonObject; remoteRequestId?: string | null;
    }) {
      return db.amazonAdsReportRequest.upsert({
        where: { organizationId_workspaceId_idempotencyKey: { organizationId: input.organizationId, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey } },
        create: { id: randomUUID(), ...input, status: input.remoteRequestId ? "SUBMITTED" : "PENDING" },
        update: {},
      });
    },
  };
}

export const amazonAdsRepository = createAmazonAdsRepository();
