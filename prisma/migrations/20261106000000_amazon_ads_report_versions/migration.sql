CREATE TABLE "AmazonAdsReportVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "profileId" TEXT NOT NULL,
  "sourceTaskId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STAGING',
  "requestedFrom" DATE,
  "requestedTo" DATE,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsReportVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsReportVersion_profile_fkey" FOREIGN KEY ("organizationId", "workspaceId", "profileId") REFERENCES "AmazonAdsProfile"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsReportVersion_task_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceTaskId") REFERENCES "AmazonAdsSyncTask"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsReportVersion_scope_id_key" UNIQUE ("organizationId", "workspaceId", "id"),
  CONSTRAINT "AmazonAdsReportVersion_task_key" UNIQUE ("organizationId", "workspaceId", "sourceTaskId")
);
CREATE INDEX "AmazonAdsReportVersion_published_idx" ON "AmazonAdsReportVersion"("organizationId", "workspaceId", "profileId", "status", "publishedAt");

ALTER TABLE "AmazonAdsReportFact" ADD COLUMN "versionId" TEXT;
DROP INDEX "AmazonAdsReportFact_business_key";
CREATE UNIQUE INDEX "AmazonAdsReportFact_version_business_key" ON "AmazonAdsReportFact"("organizationId", "workspaceId", "versionId", "reportType", "adProduct", "reportDate", "factKey");
ALTER TABLE "AmazonAdsReportFact" ADD CONSTRAINT "AmazonAdsReportFact_version_fkey" FOREIGN KEY ("organizationId", "workspaceId", "versionId") REFERENCES "AmazonAdsReportVersion"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
