CREATE TABLE "AmazonCatalogImageBlob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "contentHash" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AmazonCatalogImageBlob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonCatalogImageReference" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "sellerAccountId" TEXT NOT NULL,
  "marketplaceId" TEXT NOT NULL,
  "asin" TEXT NOT NULL,
  "variant" TEXT NOT NULL DEFAULT 'MAIN',
  "sourceResource" TEXT NOT NULL,
  "sourceRunId" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "blobId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonCatalogImageReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonCatalogImageBlob_scope_hash_key"
  ON "AmazonCatalogImageBlob"("organizationId", "workspaceId", "contentHash");
CREATE UNIQUE INDEX "AmazonCatalogImageBlob_fileId_key"
  ON "AmazonCatalogImageBlob"("fileId");
CREATE INDEX "AmazonCatalogImageBlob_scope_created_idx"
  ON "AmazonCatalogImageBlob"("organizationId", "workspaceId", "createdAt");
CREATE UNIQUE INDEX "AmazonCatalogImageReference_product_key"
  ON "AmazonCatalogImageReference"("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "asin", "variant");
CREATE INDEX "AmazonCatalogImageReference_product_idx"
  ON "AmazonCatalogImageReference"("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "asin");
CREATE INDEX "AmazonCatalogImageReference_blobId_idx"
  ON "AmazonCatalogImageReference"("blobId");

ALTER TABLE "AmazonCatalogImageBlob"
  ADD CONSTRAINT "AmazonCatalogImageBlob_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AmazonCatalogImageReference"
  ADD CONSTRAINT "AmazonCatalogImageReference_blobId_fkey"
  FOREIGN KEY ("blobId") REFERENCES "AmazonCatalogImageBlob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
