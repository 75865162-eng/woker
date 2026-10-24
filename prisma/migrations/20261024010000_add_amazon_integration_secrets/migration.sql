CREATE TABLE "AmazonIntegrationSecret" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'amazon_sp_api',
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "credentialsCiphertext" TEXT NOT NULL,
    "awsRegion" TEXT NOT NULL DEFAULT 'us-east-1',
    "endpoint" TEXT NOT NULL DEFAULT 'https://sellingpartnerapi-na.amazon.com',
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmazonIntegrationSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonIntegrationSecret_organizationId_workspaceId_key"
  ON "AmazonIntegrationSecret"("organizationId", "workspaceId");
CREATE UNIQUE INDEX "AmazonIntegrationSecret_provider_key"
  ON "AmazonIntegrationSecret"("provider");
CREATE INDEX "AmazonIntegrationSecret_organizationId_updatedAt_idx"
  ON "AmazonIntegrationSecret"("organizationId", "updatedAt");
