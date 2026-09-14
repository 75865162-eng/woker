CREATE TYPE "ProductCostType" AS ENUM ('purchase', 'freight', 'packaging', 'tariff', 'storage', 'advertising', 'other');
CREATE TYPE "ProductMediaType" AS ENUM ('image', 'video', 'document', 'workbook', 'other');

CREATE TABLE "Marketplace" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "countryCode" TEXT NOT NULL DEFAULT '',
  "region" TEXT NOT NULL DEFAULT '',
  "currency" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Marketplace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellerAccount" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "accountKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL DEFAULT '',
  "marketplaceCode" TEXT NOT NULL DEFAULT '',
  "marketplaceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "contactName" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "website" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductMaster" (
  "id" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "sku" TEXT NOT NULL,
  "chineseName" TEXT NOT NULL DEFAULT '',
  "englishName" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'dashboard',
  "currentOwner" TEXT NOT NULL DEFAULT '',
  "sourceRevision" INTEGER NOT NULL DEFAULT 1,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductMaster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductVariant" (
  "id" TEXT NOT NULL,
  "productMasterId" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "sku" TEXT NOT NULL,
  "asin" TEXT NOT NULL DEFAULT '',
  "parentAsin" TEXT NOT NULL DEFAULT '',
  "variantName" TEXT NOT NULL DEFAULT '',
  "attributes" JSONB,
  "status" TEXT NOT NULL DEFAULT '',
  "sourceRevision" INTEGER NOT NULL DEFAULT 1,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductListing" (
  "id" TEXT NOT NULL,
  "productMasterId" TEXT NOT NULL,
  "productVariantId" TEXT,
  "productRecordId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "sellerAccountId" TEXT,
  "marketplaceId" TEXT,
  "listingKey" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "asin" TEXT NOT NULL DEFAULT '',
  "listingStatus" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL DEFAULT '',
  "currency" TEXT NOT NULL DEFAULT '',
  "price" DOUBLE PRECISION,
  "inventory" INTEGER,
  "fulfillmentType" TEXT NOT NULL DEFAULT '',
  "sourceRevision" INTEGER NOT NULL DEFAULT 1,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductListing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductSupplier" (
  "id" TEXT NOT NULL,
  "productMasterId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "supplierSku" TEXT NOT NULL DEFAULT '',
  "productUrl" TEXT NOT NULL DEFAULT '',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "purchaseLeadTime" TEXT NOT NULL DEFAULT '',
  "moq" INTEGER,
  "notes" TEXT NOT NULL DEFAULT '',
  "sourceRevision" INTEGER NOT NULL DEFAULT 1,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSupplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductCost" (
  "id" TEXT NOT NULL,
  "productMasterId" TEXT NOT NULL,
  "productVariantId" TEXT,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "costType" "ProductCostType" NOT NULL DEFAULT 'purchase',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "effectiveAt" TIMESTAMP(3),
  "sourceRevision" INTEGER NOT NULL DEFAULT 1,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductMedia" (
  "id" TEXT NOT NULL,
  "productMasterId" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "fileId" TEXT,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "mediaType" "ProductMediaType" NOT NULL DEFAULT 'image',
  "role" TEXT NOT NULL DEFAULT 'gallery',
  "url" TEXT NOT NULL DEFAULT '',
  "thumbUrl" TEXT NOT NULL DEFAULT '',
  "originalUrl" TEXT NOT NULL DEFAULT '',
  "fileName" TEXT NOT NULL DEFAULT '',
  "mimeType" TEXT NOT NULL DEFAULT '',
  "size" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "sourceRevision" INTEGER NOT NULL DEFAULT 1,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Marketplace_organizationId_code_key" ON "Marketplace"("organizationId", "code");
CREATE INDEX "Marketplace_organizationId_status_updatedAt_idx" ON "Marketplace"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "SellerAccount_organizationId_workspaceId_accountKey_marketpl_key" ON "SellerAccount"("organizationId", "workspaceId", "accountKey", "marketplaceCode");
CREATE INDEX "SellerAccount_organizationId_workspaceId_status_updatedAt_idx" ON "SellerAccount"("organizationId", "workspaceId", "status", "updatedAt");
CREATE INDEX "SellerAccount_organizationId_marketplaceCode_idx" ON "SellerAccount"("organizationId", "marketplaceCode");
CREATE UNIQUE INDEX "Supplier_organizationId_normalizedName_key" ON "Supplier"("organizationId", "normalizedName");
CREATE INDEX "Supplier_organizationId_name_idx" ON "Supplier"("organizationId", "name");
CREATE INDEX "Supplier_organizationId_updatedAt_idx" ON "Supplier"("organizationId", "updatedAt");
CREATE UNIQUE INDEX "ProductMaster_productRecordId_key" ON "ProductMaster"("productRecordId");
CREATE UNIQUE INDEX "ProductMaster_organizationId_workspaceId_sku_key" ON "ProductMaster"("organizationId", "workspaceId", "sku");
CREATE INDEX "ProductMaster_organizationId_workspaceId_status_updatedAt_idx" ON "ProductMaster"("organizationId", "workspaceId", "status", "updatedAt");
CREATE INDEX "ProductMaster_organizationId_workspaceId_currentOwner_updated_idx" ON "ProductMaster"("organizationId", "workspaceId", "currentOwner", "updatedAt");
CREATE UNIQUE INDEX "ProductVariant_organizationId_workspaceId_sku_key" ON "ProductVariant"("organizationId", "workspaceId", "sku");
CREATE INDEX "ProductVariant_organizationId_workspaceId_asin_idx" ON "ProductVariant"("organizationId", "workspaceId", "asin");
CREATE INDEX "ProductVariant_organizationId_workspaceId_productMasterId_idx" ON "ProductVariant"("organizationId", "workspaceId", "productMasterId");
CREATE INDEX "ProductVariant_organizationId_workspaceId_status_updatedAt_idx" ON "ProductVariant"("organizationId", "workspaceId", "status", "updatedAt");
CREATE UNIQUE INDEX "ProductListing_organizationId_workspaceId_listingKey_key" ON "ProductListing"("organizationId", "workspaceId", "listingKey");
CREATE INDEX "ProductListing_organizationId_workspaceId_sku_idx" ON "ProductListing"("organizationId", "workspaceId", "sku");
CREATE INDEX "ProductListing_organizationId_workspaceId_asin_idx" ON "ProductListing"("organizationId", "workspaceId", "asin");
CREATE INDEX "ProductListing_organizationId_workspaceId_listingStatus_updated_idx" ON "ProductListing"("organizationId", "workspaceId", "listingStatus", "updatedAt");
CREATE UNIQUE INDEX "ProductSupplier_organizationId_workspaceId_productMasterId_sup_key" ON "ProductSupplier"("organizationId", "workspaceId", "productMasterId", "supplierId");
CREATE INDEX "ProductSupplier_organizationId_workspaceId_supplierId_idx" ON "ProductSupplier"("organizationId", "workspaceId", "supplierId");
CREATE INDEX "ProductSupplier_organizationId_workspaceId_isPrimary_idx" ON "ProductSupplier"("organizationId", "workspaceId", "isPrimary");
CREATE INDEX "ProductCost_organizationId_workspaceId_productMasterId_costT_idx" ON "ProductCost"("organizationId", "workspaceId", "productMasterId", "costType", "updatedAt");
CREATE INDEX "ProductCost_organizationId_workspaceId_productVariantId_cost_idx" ON "ProductCost"("organizationId", "workspaceId", "productVariantId", "costType", "updatedAt");
CREATE INDEX "ProductMedia_organizationId_workspaceId_productMasterId_media_idx" ON "ProductMedia"("organizationId", "workspaceId", "productMasterId", "mediaType", "sortOrder");
CREATE INDEX "ProductMedia_organizationId_workspaceId_productRecordId_idx" ON "ProductMedia"("organizationId", "workspaceId", "productRecordId");
CREATE INDEX "ProductMedia_fileId_idx" ON "ProductMedia"("fileId");

ALTER TABLE "Marketplace" ADD CONSTRAINT "Marketplace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerAccount" ADD CONSTRAINT "SellerAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerAccount" ADD CONSTRAINT "SellerAccount_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "Marketplace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMaster" ADD CONSTRAINT "ProductMaster_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMaster" ADD CONSTRAINT "ProductMaster_productRecordId_fkey" FOREIGN KEY ("productRecordId") REFERENCES "ProductRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "ProductMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productRecordId_fkey" FOREIGN KEY ("productRecordId") REFERENCES "ProductRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "ProductMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_productRecordId_fkey" FOREIGN KEY ("productRecordId") REFERENCES "ProductRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "Marketplace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "ProductMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "ProductMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "ProductMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_productRecordId_fkey" FOREIGN KEY ("productRecordId") REFERENCES "ProductRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
