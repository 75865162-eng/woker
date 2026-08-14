CREATE TABLE "WorkspaceDataset" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "accountId" TEXT NOT NULL DEFAULT '',
  "marketplace" TEXT NOT NULL DEFAULT '',
  "fileId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "sourceFileName" TEXT NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "campaignCount" INTEGER NOT NULL DEFAULT 0,
  "campaignGroups" JSONB NOT NULL,
  "performanceRows" JSONB NOT NULL,
  "dataBatches" JSONB NOT NULL,
  "parseDiagnostics" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceDataset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DraftRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "accountId" TEXT NOT NULL DEFAULT '',
  "marketplace" TEXT NOT NULL DEFAULT '',
  "datasetId" TEXT,
  "fileId" TEXT,
  "scopeType" TEXT NOT NULL,
  "campaignGroupIds" JSONB NOT NULL,
  "campaignGroupNames" JSONB NOT NULL,
  "rulesSnapshot" JSONB NOT NULL,
  "overallAdDataRows" JSONB NOT NULL,
  "overallAdDataMatchSummary" JSONB NOT NULL,
  "drafts" JSONB NOT NULL,
  "selectedDraftIds" JSONB NOT NULL,
  "summary" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "exportedAt" TIMESTAMP(3),
  "exportFileName" TEXT,
  CONSTRAINT "DraftRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ExportRecord" ADD COLUMN "draftRunId" TEXT;
ALTER TABLE "ExportRecord" ADD COLUMN "draftIds" JSONB;
ALTER TABLE "ExportRecord" ADD COLUMN "validation" JSONB;
ALTER TABLE "ExportRecord" ADD COLUMN "lineage" JSONB;

CREATE UNIQUE INDEX "WorkspaceDataset_jobId_key" ON "WorkspaceDataset"("jobId");
CREATE INDEX "WorkspaceDataset_organizationId_createdAt_idx" ON "WorkspaceDataset"("organizationId", "createdAt");
CREATE INDEX "WorkspaceDataset_organizationId_workspaceId_createdAt_idx" ON "WorkspaceDataset"("organizationId", "workspaceId", "createdAt");
CREATE INDEX "WorkspaceDataset_organizationId_accountId_marketplace_createdAt_idx" ON "WorkspaceDataset"("organizationId", "accountId", "marketplace", "createdAt");
CREATE INDEX "WorkspaceDataset_userId_createdAt_idx" ON "WorkspaceDataset"("userId", "createdAt");
CREATE INDEX "WorkspaceDataset_fileId_idx" ON "WorkspaceDataset"("fileId");

CREATE INDEX "DraftRun_organizationId_createdAt_idx" ON "DraftRun"("organizationId", "createdAt");
CREATE INDEX "DraftRun_organizationId_workspaceId_createdAt_idx" ON "DraftRun"("organizationId", "workspaceId", "createdAt");
CREATE INDEX "DraftRun_organizationId_accountId_marketplace_createdAt_idx" ON "DraftRun"("organizationId", "accountId", "marketplace", "createdAt");
CREATE INDEX "DraftRun_userId_createdAt_idx" ON "DraftRun"("userId", "createdAt");
CREATE INDEX "DraftRun_datasetId_idx" ON "DraftRun"("datasetId");
CREATE INDEX "DraftRun_fileId_idx" ON "DraftRun"("fileId");
CREATE INDEX "ExportRecord_draftRunId_idx" ON "ExportRecord"("draftRunId");

ALTER TABLE "WorkspaceDataset" ADD CONSTRAINT "WorkspaceDataset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceDataset" ADD CONSTRAINT "WorkspaceDataset_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceDataset" ADD CONSTRAINT "WorkspaceDataset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DraftRun" ADD CONSTRAINT "DraftRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DraftRun" ADD CONSTRAINT "DraftRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "WorkspaceDataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DraftRun" ADD CONSTRAINT "DraftRun_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExportRecord" ADD CONSTRAINT "ExportRecord_draftRunId_fkey" FOREIGN KEY ("draftRunId") REFERENCES "DraftRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
