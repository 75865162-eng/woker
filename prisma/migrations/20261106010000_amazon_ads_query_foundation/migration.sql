-- Additive Amazon Ads query and lifecycle foundation. No existing business rows
-- are rewritten; nullable columns keep older releases compatible during rollout.

ALTER TABLE "AmazonAdsEntityRecord"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "adProduct" TEXT,
  ADD COLUMN "campaignId" TEXT,
  ADD COLUMN "adGroupId" TEXT,
  ADD COLUMN "startDate" DATE,
  ADD COLUMN "endDate" DATE,
  ADD COLUMN "targetingType" TEXT,
  ADD COLUMN "budgetAmount" DECIMAL(20,6),
  ADD COLUMN "budgetType" TEXT,
  ADD COLUMN "bid" DECIMAL(20,6),
  ADD COLUMN "keywordText" TEXT,
  ADD COLUMN "matchType" TEXT,
  ADD COLUMN "expressionType" TEXT,
  ADD COLUMN "targetingExpression" JSONB;

CREATE INDEX "AmazonAdsEntity_list_idx"
  ON "AmazonAdsEntityRecord"("organizationId", "workspaceId", "profileId", "entityType", "state", "name");

ALTER TABLE "AmazonAdsReportFact"
  ALTER COLUMN "impressions" DROP NOT NULL,
  ALTER COLUMN "impressions" DROP DEFAULT,
  ALTER COLUMN "clicks" DROP NOT NULL,
  ALTER COLUMN "clicks" DROP DEFAULT,
  ALTER COLUMN "spend" DROP NOT NULL,
  ALTER COLUMN "spend" DROP DEFAULT,
  ALTER COLUMN "orders" DROP NOT NULL,
  ALTER COLUMN "orders" DROP DEFAULT,
  ALTER COLUMN "sales" DROP NOT NULL,
  ALTER COLUMN "sales" DROP DEFAULT,
  ALTER COLUMN "units" DROP NOT NULL,
  ALTER COLUMN "units" DROP DEFAULT,
  ADD COLUMN "currencyCode" TEXT;

-- Keep legacy version-less facts idempotent after the report-version migration
-- replaces the old unconditional unique index. New facts are unique per version.
CREATE UNIQUE INDEX "AmazonAdsReportFact_legacy_business_key"
  ON "AmazonAdsReportFact"("organizationId", "workspaceId", "profileId", "reportType", "adProduct", "reportDate", "factKey")
  WHERE "versionId" IS NULL;

CREATE UNIQUE INDEX "AmazonAdsSyncTask_scope_profile_key"
  ON "AmazonAdsSyncTask"("organizationId", "workspaceId", "id", "profileId");
CREATE UNIQUE INDEX "AmazonAdsReportVersion_scope_task_key"
  ON "AmazonAdsReportVersion"("organizationId", "workspaceId", "id", "profileId", "sourceTaskId");

-- Fail safely rather than reassigning any existing record across Profiles.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "AmazonAdsEntityRecord" e
    JOIN "AmazonAdsSyncTask" t ON t."organizationId" = e."organizationId" AND t."workspaceId" = e."workspaceId" AND t."id" = e."sourceTaskId"
    WHERE t."profileId" <> e."profileId"
  ) OR EXISTS (
    SELECT 1 FROM "AmazonAdsReportVersion" v
    JOIN "AmazonAdsSyncTask" t ON t."organizationId" = v."organizationId" AND t."workspaceId" = v."workspaceId" AND t."id" = v."sourceTaskId"
    WHERE t."profileId" <> v."profileId"
  ) OR EXISTS (
    SELECT 1 FROM "AmazonAdsReportFact" f
    JOIN "AmazonAdsSyncTask" t ON t."organizationId" = f."organizationId" AND t."workspaceId" = f."workspaceId" AND t."id" = f."sourceTaskId"
    WHERE t."profileId" <> f."profileId"
  ) OR EXISTS (
    SELECT 1 FROM "AmazonAdsReportFact" f
    JOIN "AmazonAdsReportVersion" v ON v."organizationId" = f."organizationId" AND v."workspaceId" = f."workspaceId" AND v."id" = f."versionId"
    WHERE v."profileId" <> f."profileId" OR v."sourceTaskId" <> f."sourceTaskId"
  ) THEN
    RAISE EXCEPTION 'Amazon Ads rows cross Profile/task boundaries; reconcile them before applying query-foundation constraints.';
  END IF;
END $$;

ALTER TABLE "AmazonAdsEntityRecord" DROP CONSTRAINT "AmazonAdsEntityRecord_task_fkey";
ALTER TABLE "AmazonAdsEntityRecord" ADD CONSTRAINT "AmazonAdsEntityRecord_task_profile_fkey"
  FOREIGN KEY ("organizationId", "workspaceId", "sourceTaskId", "profileId")
  REFERENCES "AmazonAdsSyncTask"("organizationId", "workspaceId", "id", "profileId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AmazonAdsReportVersion" DROP CONSTRAINT "AmazonAdsReportVersion_task_fkey";
ALTER TABLE "AmazonAdsReportVersion" ADD CONSTRAINT "AmazonAdsReportVersion_task_profile_fkey"
  FOREIGN KEY ("organizationId", "workspaceId", "sourceTaskId", "profileId")
  REFERENCES "AmazonAdsSyncTask"("organizationId", "workspaceId", "id", "profileId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AmazonAdsReportFact" DROP CONSTRAINT "AmazonAdsReportFact_task_fkey";
ALTER TABLE "AmazonAdsReportFact" ADD CONSTRAINT "AmazonAdsReportFact_task_profile_fkey"
  FOREIGN KEY ("organizationId", "workspaceId", "sourceTaskId", "profileId")
  REFERENCES "AmazonAdsSyncTask"("organizationId", "workspaceId", "id", "profileId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AmazonAdsReportFact" DROP CONSTRAINT "AmazonAdsReportFact_version_fkey";
ALTER TABLE "AmazonAdsReportFact" ADD CONSTRAINT "AmazonAdsReportFact_version_profile_task_fkey"
  FOREIGN KEY ("organizationId", "workspaceId", "versionId", "profileId", "sourceTaskId")
  REFERENCES "AmazonAdsReportVersion"("organizationId", "workspaceId", "id", "profileId", "sourceTaskId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AmazonAdsSyncDomainState" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "profileId" TEXT NOT NULL,
  "dataDomain" TEXT NOT NULL,
  "reportType" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "coveredFrom" DATE,
  "coveredTo" DATE,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastTaskId" TEXT,
  "warningCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsSyncDomainState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsSyncDomainState_profile_fkey" FOREIGN KEY ("organizationId", "workspaceId", "profileId") REFERENCES "AmazonAdsProfile"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsSyncDomainState_task_fkey" FOREIGN KEY ("organizationId", "workspaceId", "lastTaskId", "profileId") REFERENCES "AmazonAdsSyncTask"("organizationId", "workspaceId", "id", "profileId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsSyncDomainState_domain_key" UNIQUE ("organizationId", "workspaceId", "profileId", "dataDomain", "reportType")
);
CREATE INDEX "AmazonAdsSyncDomainState_freshness_idx"
  ON "AmazonAdsSyncDomainState"("organizationId", "workspaceId", "profileId", "dataDomain", "lastSuccessAt");

CREATE TABLE "AmazonAdsSyncAttempt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "profileId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "stage" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "retryAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "safeErrorSummary" TEXT,
  "apiRequests" INTEGER NOT NULL DEFAULT 0,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AmazonAdsSyncAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsSyncAttempt_profile_fkey" FOREIGN KEY ("organizationId", "workspaceId", "profileId") REFERENCES "AmazonAdsProfile"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsSyncAttempt_task_profile_fkey" FOREIGN KEY ("organizationId", "workspaceId", "taskId", "profileId") REFERENCES "AmazonAdsSyncTask"("organizationId", "workspaceId", "id", "profileId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsSyncAttempt_task_number_key" UNIQUE ("organizationId", "workspaceId", "taskId", "attemptNumber")
);
CREATE INDEX "AmazonAdsSyncAttempt_profile_idx"
  ON "AmazonAdsSyncAttempt"("organizationId", "workspaceId", "profileId", "startedAt");

CREATE TABLE "AmazonAdsReportRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "profileId" TEXT NOT NULL,
  "sourceTaskId" TEXT NOT NULL,
  "versionId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "apiVersion" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "adProduct" TEXT NOT NULL,
  "requestedFrom" DATE NOT NULL,
  "requestedTo" DATE NOT NULL,
  "requestOptions" JSONB NOT NULL,
  "remoteRequestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "warningCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "errorCode" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastPolledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsReportRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsReportRequest_profile_fkey" FOREIGN KEY ("organizationId", "workspaceId", "profileId") REFERENCES "AmazonAdsProfile"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsReportRequest_task_profile_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceTaskId", "profileId") REFERENCES "AmazonAdsSyncTask"("organizationId", "workspaceId", "id", "profileId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsReportRequest_version_profile_task_fkey" FOREIGN KEY ("organizationId", "workspaceId", "versionId", "profileId", "sourceTaskId") REFERENCES "AmazonAdsReportVersion"("organizationId", "workspaceId", "id", "profileId", "sourceTaskId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsReportRequest_idempotency_key" UNIQUE ("organizationId", "workspaceId", "idempotencyKey"),
  CONSTRAINT "AmazonAdsReportRequest_scope_profile_key" UNIQUE ("organizationId", "workspaceId", "id", "profileId"),
  CONSTRAINT "AmazonAdsReportRequest_remote_key" UNIQUE ("organizationId", "workspaceId", "profileId", "remoteRequestId")
);
CREATE INDEX "AmazonAdsReportRequest_status_idx"
  ON "AmazonAdsReportRequest"("organizationId", "workspaceId", "profileId", "status", "requestedAt");

CREATE TABLE "AmazonAdsReportDocument" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "profileId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "partIndex" INTEGER NOT NULL DEFAULT 0,
  "format" TEXT,
  "compression" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "storageFileId" TEXT,
  "contentSha256" TEXT,
  "byteSize" BIGINT,
  "rowCount" INTEGER,
  "downloadedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsReportDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsReportDocument_request_fkey" FOREIGN KEY ("organizationId", "workspaceId", "requestId", "profileId") REFERENCES "AmazonAdsReportRequest"("organizationId", "workspaceId", "id", "profileId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsReportDocument_request_part_key" UNIQUE ("organizationId", "workspaceId", "requestId", "partIndex")
);
CREATE INDEX "AmazonAdsReportDocument_status_idx"
  ON "AmazonAdsReportDocument"("organizationId", "workspaceId", "profileId", "status", "createdAt");
