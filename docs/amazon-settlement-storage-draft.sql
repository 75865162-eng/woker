-- REVIEW DRAFT ONLY. Not a registered Prisma migration. Do not execute.
-- Requires separate schema approval, matching Prisma relations, temporary-DB
-- validation and deployment approval. No existing table/data is changed here.
CREATE TABLE "AmazonSettlementReport" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "amazonSellerId" TEXT NOT NULL CHECK (length(btrim("amazonSellerId")) > 0),
  "region" TEXT NOT NULL CHECK (length(btrim("region")) > 0),
  "reportType" TEXT NOT NULL CHECK ("reportType" = 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2'),
  "reportId" TEXT NOT NULL CHECK (length(btrim("reportId")) BETWEEN 1 AND 200),
  "authorizationId" TEXT NOT NULL,
  "authorizationRevision" INTEGER NOT NULL CHECK ("authorizationRevision" > 0),
  "sourceRunId" TEXT NOT NULL,
  "reportMarketplaceIds" JSONB NOT NULL CHECK (jsonb_typeof("reportMarketplaceIds") = 'array'),
  "collectionMarketplaceIds" JSONB NOT NULL CHECK (jsonb_typeof("collectionMarketplaceIds") = 'array'),
  "siteBindings" JSONB NOT NULL CHECK (jsonb_typeof("siteBindings") = 'array'),
  "rawTaskId" TEXT,
  "rawPage" INTEGER,
  "contentSha256" TEXT CHECK ("contentSha256" IS NULL OR "contentSha256" ~ '^[a-f0-9]{64}$'),
  "status" TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK ("status" IN ('DISCOVERED','ARCHIVED','STAGED','PUBLISHED','BLOCKED')),
  "createdTime" TIMESTAMPTZ(3),
  "capturedAt" TIMESTAMPTZ(3),
  "publishedAt" TIMESTAMPTZ(3),
  CONSTRAINT "AmazonSettlementReport_business_key" UNIQUE ("organizationId","workspaceId","amazonSellerId","region","reportType","reportId"),
  CONSTRAINT "AmazonSettlementReport_scope_key" UNIQUE ("organizationId","workspaceId","id"),
  CONSTRAINT "AmazonSettlementReport_auth_fkey" FOREIGN KEY ("organizationId","workspaceId","authorizationId") REFERENCES "AmazonSpApiAuthorization" ("organizationId","workspaceId","id") ON DELETE RESTRICT,
  CONSTRAINT "AmazonSettlementReport_run_fkey" FOREIGN KEY ("organizationId","workspaceId","sourceRunId") REFERENCES "AmazonSyncRun" ("organizationId","workspaceId","id") ON DELETE RESTRICT,
  CONSTRAINT "AmazonSettlementReport_raw_scope_fkey" FOREIGN KEY ("organizationId","workspaceId","rawTaskId") REFERENCES "AmazonSyncRun" ("organizationId","workspaceId","id") ON DELETE RESTRICT,
  CONSTRAINT "AmazonSettlementReport_raw_fkey" FOREIGN KEY ("rawTaskId","rawPage") REFERENCES "AmazonSyncRawPage" ("taskId","page") ON DELETE RESTRICT,
  CONSTRAINT "AmazonSettlementReport_raw_pair" CHECK (("rawTaskId" IS NULL AND "rawPage" IS NULL) OR ("rawTaskId" IS NOT NULL AND "rawPage" IS NOT NULL AND "rawPage" > 0)),
  CONSTRAINT "AmazonSettlementReport_publication" CHECK ("status" <> 'PUBLISHED' OR ("rawTaskId" IS NOT NULL AND "contentSha256" IS NOT NULL AND "publishedAt" IS NOT NULL))
);
CREATE INDEX "AmazonSettlementReport_scope_status_idx" ON "AmazonSettlementReport" ("organizationId","workspaceId","status","createdTime");

CREATE TABLE "AmazonSettlementRow" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "reportDocumentId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL CHECK ("rowNumber" > 0),
  "rowHash" TEXT NOT NULL CHECK ("rowHash" ~ '^[a-f0-9]{64}$'),
  "sourceId" TEXT,
  "marketplaceId" TEXT,
  "sellerAccountId" TEXT,
  "attributionStatus" TEXT NOT NULL CHECK ("attributionStatus" IN ('ATTRIBUTED','MISSING_MARKETPLACE','CONFLICTING_MARKETPLACE','OUT_OF_SCOPE')),
  "businessDate" VARCHAR(10),
  "businessDateRaw" TEXT,
  "orderId" TEXT,
  "sellerSku" TEXT,
  "asin" TEXT,
  "amountOriginal" TEXT,
  "currencyCode" TEXT,
  "transactionType" TEXT,
  "amountType" TEXT,
  "amountDescription" TEXT,
  "fields" JSONB CHECK ("fields" IS NULL OR jsonb_typeof("fields") = 'object'),
  CONSTRAINT "AmazonSettlementRow_document_row_key" UNIQUE ("reportDocumentId","rowNumber"),
  CONSTRAINT "AmazonSettlementRow_report_fkey" FOREIGN KEY ("organizationId","workspaceId","reportDocumentId") REFERENCES "AmazonSettlementReport" ("organizationId","workspaceId","id") ON DELETE RESTRICT,
  CONSTRAINT "AmazonSettlementRow_source_fkey" FOREIGN KEY ("organizationId","workspaceId","sourceId") REFERENCES "AmazonSyncDataSource" ("organizationId","workspaceId","id") ON DELETE RESTRICT,
  CONSTRAINT "AmazonSettlementRow_attribution" CHECK (
    ("attributionStatus" = 'ATTRIBUTED' AND "sourceId" IS NOT NULL AND "marketplaceId" IS NOT NULL AND "sellerAccountId" IS NOT NULL)
    OR
    ("attributionStatus" <> 'ATTRIBUTED' AND "sourceId" IS NULL AND "marketplaceId" IS NULL AND "sellerAccountId" IS NULL
      AND "businessDate" IS NULL AND "businessDateRaw" IS NULL AND "orderId" IS NULL AND "sellerSku" IS NULL AND "asin" IS NULL
      AND "amountOriginal" IS NULL AND "currencyCode" IS NULL AND "transactionType" IS NULL AND "amountType" IS NULL
      AND "amountDescription" IS NULL AND "fields" IS NULL)
  )
);
CREATE INDEX "AmazonSettlementRow_source_date_idx" ON "AmazonSettlementRow" ("organizationId","workspaceId","sourceId","businessDate");
