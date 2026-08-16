CREATE TABLE "ProductRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductImageCopyGalleryRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductImageCopyGalleryRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductRecord_organizationId_sku_key" ON "ProductRecord"("organizationId", "sku");
CREATE INDEX "ProductRecord_organizationId_updatedAt_idx" ON "ProductRecord"("organizationId", "updatedAt");
CREATE INDEX "ProductRecord_userId_updatedAt_idx" ON "ProductRecord"("userId", "updatedAt");

CREATE UNIQUE INDEX "ProductImageCopyGalleryRecord_organizationId_sku_key" ON "ProductImageCopyGalleryRecord"("organizationId", "sku");
CREATE INDEX "ProductImageCopyGalleryRecord_organizationId_updatedAt_idx" ON "ProductImageCopyGalleryRecord"("organizationId", "updatedAt");
CREATE INDEX "ProductImageCopyGalleryRecord_userId_updatedAt_idx" ON "ProductImageCopyGalleryRecord"("userId", "updatedAt");
