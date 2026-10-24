CREATE TABLE "AmazonSellerBinding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "sellerAccountId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "amazonSellerId" TEXT NOT NULL,
    "authorizedResources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmazonSellerBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonSellerBinding_organizationId_workspaceId_sellerAccountId_marketplaceId_key"
  ON "AmazonSellerBinding"("organizationId", "workspaceId", "sellerAccountId", "marketplaceId");
CREATE UNIQUE INDEX "AmazonSellerBinding_organizationId_workspaceId_amazonSellerId_marketplaceId_key"
  ON "AmazonSellerBinding"("organizationId", "workspaceId", "amazonSellerId", "marketplaceId");
CREATE INDEX "AmazonSellerBinding_organizationId_workspaceId_updatedAt_idx"
  ON "AmazonSellerBinding"("organizationId", "workspaceId", "updatedAt");
