-- Ads sync data is isolated from SP-API snapshots and task rows.
CREATE UNIQUE INDEX "AmazonAdsProfile_scope_id_key"
  ON "AmazonAdsProfile"("organizationId", "workspaceId", "id");

CREATE TABLE "AmazonAdsSyncPlan" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "profileId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "sellerAccountId" TEXT NOT NULL,
  "authorizationRevision" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 1440,
  "historyStartDate" TIMESTAMP(3),
  "reportLookbackDays" INTEGER NOT NULL DEFAULT 14,
  "attributionLagDays" INTEGER NOT NULL DEFAULT 14,
  "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastEnqueuedAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsSyncPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsSyncPlan_profile_fkey" FOREIGN KEY ("organizationId", "workspaceId", "profileId") REFERENCES "AmazonAdsProfile"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsSyncPlan_seller_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sellerAccountId") REFERENCES "SellerAccount"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsSyncPlan_actor_fkey" FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonAdsSyncPlan_profile_key" ON "AmazonAdsSyncPlan"("organizationId", "workspaceId", "profileId");
CREATE UNIQUE INDEX "AmazonAdsSyncPlan_scope_id_key" ON "AmazonAdsSyncPlan"("organizationId", "workspaceId", "id");
CREATE INDEX "AmazonAdsSyncPlan_due_idx" ON "AmazonAdsSyncPlan"("status", "nextRunAt");
CREATE INDEX "AmazonAdsSyncPlan_scope_due_idx" ON "AmazonAdsSyncPlan"("organizationId", "workspaceId", "status", "nextRunAt");

CREATE TABLE "AmazonAdsSyncTask" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "planId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "planRevision" INTEGER NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'schedule',
  "status" TEXT NOT NULL DEFAULT 'WAITING',
  "stage" TEXT NOT NULL DEFAULT 'DISCOVER',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "dispatchVersion" INTEGER NOT NULL DEFAULT 1,
  "fenceVersion" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkpointCiphertext" TEXT,
  "requestedFrom" TIMESTAMP(3),
  "requestedTo" TIMESTAMP(3),
  "apiRequests" INTEGER NOT NULL DEFAULT 0,
  "throttles" INTEGER NOT NULL DEFAULT 0,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "insertedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsSyncTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsSyncTask_plan_fkey" FOREIGN KEY ("organizationId", "workspaceId", "planId") REFERENCES "AmazonAdsSyncPlan"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsSyncTask_profile_fkey" FOREIGN KEY ("organizationId", "workspaceId", "profileId") REFERENCES "AmazonAdsProfile"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsSyncTask_actor_fkey" FOREIGN KEY ("organizationId", "requestedByUserId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonAdsSyncTask_idempotency_key" ON "AmazonAdsSyncTask"("organizationId", "workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "AmazonAdsSyncTask_scope_id_key" ON "AmazonAdsSyncTask"("organizationId", "workspaceId", "id");
CREATE INDEX "AmazonAdsSyncTask_dispatch_idx" ON "AmazonAdsSyncTask"("status", "nextAttemptAt");
CREATE INDEX "AmazonAdsSyncTask_profile_idx" ON "AmazonAdsSyncTask"("organizationId", "workspaceId", "profileId", "createdAt");

CREATE TABLE "AmazonAdsEntityRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "profileId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "parentExternalId" TEXT,
  "state" TEXT,
  "payload" JSONB NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceTaskId" TEXT NOT NULL,
  CONSTRAINT "AmazonAdsEntityRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsEntityRecord_profile_fkey" FOREIGN KEY ("organizationId", "workspaceId", "profileId") REFERENCES "AmazonAdsProfile"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsEntityRecord_task_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceTaskId") REFERENCES "AmazonAdsSyncTask"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonAdsEntity_business_key" ON "AmazonAdsEntityRecord"("organizationId", "workspaceId", "profileId", "entityType", "externalId");
CREATE INDEX "AmazonAdsEntity_parent_idx" ON "AmazonAdsEntityRecord"("organizationId", "workspaceId", "profileId", "entityType", "parentExternalId");
CREATE INDEX "AmazonAdsEntity_sync_idx" ON "AmazonAdsEntityRecord"("organizationId", "workspaceId", "profileId", "syncedAt");

CREATE TABLE "AmazonAdsReportFact" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "profileId" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "adProduct" TEXT NOT NULL,
  "reportDate" DATE NOT NULL,
  "factKey" TEXT NOT NULL,
  "campaignId" TEXT,
  "adGroupId" TEXT,
  "targetingId" TEXT,
  "advertisedAsin" TEXT,
  "searchTerm" TEXT,
  "placement" TEXT,
  "impressions" BIGINT NOT NULL DEFAULT 0,
  "clicks" BIGINT NOT NULL DEFAULT 0,
  "spend" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "orders" BIGINT NOT NULL DEFAULT 0,
  "sales" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "units" BIGINT NOT NULL DEFAULT 0,
  "attributionWindow" TEXT,
  "apiVersion" TEXT NOT NULL,
  "sourceTaskId" TEXT NOT NULL,
  "rawDimensions" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AmazonAdsReportFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsReportFact_profile_fkey" FOREIGN KEY ("organizationId", "workspaceId", "profileId") REFERENCES "AmazonAdsProfile"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsReportFact_task_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceTaskId") REFERENCES "AmazonAdsSyncTask"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonAdsReportFact_business_key" ON "AmazonAdsReportFact"("organizationId", "workspaceId", "profileId", "reportType", "adProduct", "reportDate", "factKey");
CREATE INDEX "AmazonAdsReportFact_profile_date_idx" ON "AmazonAdsReportFact"("organizationId", "workspaceId", "profileId", "reportDate");
CREATE INDEX "AmazonAdsReportFact_campaign_date_idx" ON "AmazonAdsReportFact"("organizationId", "workspaceId", "profileId", "campaignId", "reportDate");
