-- CreateTable
CREATE TABLE "AmazonDataSourceRegistry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'OBSERVED',
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AmazonDataSourceRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonFieldRegistry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceRegistryId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "sourcePathCiphertext" TEXT NOT NULL,
    "layer" TEXT NOT NULL DEFAULT 'L0',
    "verificationStatus" TEXT NOT NULL DEFAULT 'OBSERVED',
    "mappingStatus" TEXT NOT NULL DEFAULT 'UNMAPPED',
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AmazonFieldRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonFieldMappingVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fieldRegistryId" TEXT NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    "targetTable" TEXT NOT NULL,
    "targetColumn" TEXT NOT NULL,
    "transformRule" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMPTZ(3),
    "effectiveTo" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmazonFieldMappingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonFieldObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fieldRegistryId" TEXT NOT NULL,
    "rawTaskId" TEXT NOT NULL,
    "rawPage" INTEGER NOT NULL,
    "scannerVersion" TEXT NOT NULL,
    "observedTypes" JSONB NOT NULL,
    "nullCount" BIGINT,
    "nonNullCount" BIGINT,
    "emptyStringCount" BIGINT,
    "scanComplete" BOOLEAN NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AmazonFieldObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmazonDataRegistry_identity_key" ON "AmazonDataSourceRegistry"("organizationId", "workspaceId", "provider", "sourceCode", "apiVersion");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonDataRegistry_scope_key" ON "AmazonDataSourceRegistry"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonFieldRegistry_identity_key" ON "AmazonFieldRegistry"("organizationId", "workspaceId", "sourceRegistryId", "fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonFieldRegistry_scope_key" ON "AmazonFieldRegistry"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonFieldMapping_version_key" ON "AmazonFieldMappingVersion"("organizationId", "workspaceId", "fieldRegistryId", "mappingVersion");

-- CreateIndex
CREATE INDEX "AmazonFieldObservation_scope_idx" ON "AmazonFieldObservation"("organizationId", "workspaceId", "fieldRegistryId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonFieldObservation_archive_key" ON "AmazonFieldObservation"("organizationId", "workspaceId", "rawTaskId", "rawPage", "fieldRegistryId", "scannerVersion");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonRaw_scope_page_key" ON "AmazonSyncRawPage"("organizationId", "workspaceId", "taskId", "page");

-- AddForeignKey
ALTER TABLE "AmazonFieldRegistry" ADD CONSTRAINT "AmazonFieldRegistry_organizationId_workspaceId_sourceRegis_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceRegistryId") REFERENCES "AmazonDataSourceRegistry"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonFieldMappingVersion" ADD CONSTRAINT "AmazonFieldMappingVersion_organizationId_workspaceId_field_fkey" FOREIGN KEY ("organizationId", "workspaceId", "fieldRegistryId") REFERENCES "AmazonFieldRegistry"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonFieldObservation" ADD CONSTRAINT "AmazonFieldObservation_organizationId_workspaceId_fieldReg_fkey" FOREIGN KEY ("organizationId", "workspaceId", "fieldRegistryId") REFERENCES "AmazonFieldRegistry"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonFieldObservation" ADD CONSTRAINT "AmazonFieldObservation_organizationId_workspaceId_rawTaskI_fkey" FOREIGN KEY ("organizationId", "workspaceId", "rawTaskId", "rawPage") REFERENCES "AmazonSyncRawPage"("organizationId", "workspaceId", "taskId", "page") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Add provenance for report-header currency resolution. No existing fact rewrite.
ALTER TABLE "AmazonSettlementRow" ADD COLUMN "currencySource" TEXT, ADD COLUMN "currencySourceRowNumber" INTEGER;
ALTER TABLE "AmazonSyncReportRow" ADD COLUMN "currencySource" TEXT, ADD COLUMN "currencySourceRowNumber" INTEGER;

ALTER TABLE "AmazonFieldMappingVersion" ADD CONSTRAINT "AmazonFieldMapping_positive_version" CHECK ("mappingVersion" > 0);
ALTER TABLE "AmazonFieldObservation" ADD CONSTRAINT "AmazonFieldObservation_nonnegative_counts" CHECK (
  ("nullCount" IS NULL OR "nullCount" >= 0) AND
  ("nonNullCount" IS NULL OR "nonNullCount" >= 0) AND
  ("emptyStringCount" IS NULL OR "emptyStringCount" >= 0)
);
ALTER TABLE "AmazonSettlementRow" ADD CONSTRAINT "AmazonSettlementRow_currency_provenance" CHECK (
  ("currencySource" IS NULL AND "currencySourceRowNumber" IS NULL) OR
  ("currencyCode" IS NOT NULL AND "currencySource" IS NOT NULL AND "currencySourceRowNumber" IS NOT NULL AND "currencySource" IN ('ROW', 'SETTLEMENT_HEADER') AND "currencySourceRowNumber" > 0)
);
ALTER TABLE "AmazonSyncReportRow" ADD CONSTRAINT "AmazonReportRow_currency_provenance" CHECK (
  ("currencySource" IS NULL AND "currencySourceRowNumber" IS NULL) OR
  ("currencyCode" IS NOT NULL AND "currencySource" IS NOT NULL AND "currencySourceRowNumber" IS NOT NULL AND "currencySource" IN ('ROW', 'SETTLEMENT_HEADER') AND "currencySourceRowNumber" > 0)
);
