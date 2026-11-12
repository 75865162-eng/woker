-- CreateEnum
CREATE TYPE "WmsStocktakeStatus" AS ENUM ('DRAFT', 'COUNTING', 'REVIEW', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WmsStocktake" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "WmsStocktakeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "postedCommandId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsStocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsStocktakeLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WmsStocktakeLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsStocktakeLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "baselineRevision" INTEGER,
    "baselineOnHand" INTEGER NOT NULL,
    "baselinePendingQc" INTEGER NOT NULL,
    "baselinePendingPutaway" INTEGER NOT NULL,
    "baselineRejected" INTEGER NOT NULL,
    "baselineReserved" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "countedBy" TEXT,
    "countedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsStocktakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WmsStocktake_scope_work_idx" ON "WmsStocktake"("organizationId", "workspaceId", "warehouseId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsStocktake_organizationId_workspaceId_warehouseId_id_key" ON "WmsStocktake"("organizationId", "workspaceId", "warehouseId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsStocktake_organizationId_workspaceId_number_key" ON "WmsStocktake"("organizationId", "workspaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "WmsStocktake_organizationId_workspaceId_postedCommandId_key" ON "WmsStocktake"("organizationId", "workspaceId", "postedCommandId");

-- CreateIndex
CREATE UNIQUE INDEX "WmsStocktakeLocation_scope_location_key" ON "WmsStocktakeLocation"("organizationId", "workspaceId", "stocktakeId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "WmsStocktakeLine_scope_lot_key" ON "WmsStocktakeLine"("organizationId", "workspaceId", "stocktakeId", "locationId", "lotId");

-- AddForeignKey
ALTER TABLE "WmsStocktake" ADD CONSTRAINT "WmsStocktake_organizationId_workspaceId_warehouseId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "warehouseId") REFERENCES "WmsWarehouse"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsStocktake" ADD CONSTRAINT "WmsStocktake_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsStocktake" ADD CONSTRAINT "WmsStocktake_organizationId_workspaceId_postedCommandId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "postedCommandId") REFERENCES "WmsCommand"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsStocktakeLocation" ADD CONSTRAINT "WmsStocktakeLocation_stocktake_fkey" FOREIGN KEY ("organizationId", "workspaceId", "warehouseId", "stocktakeId") REFERENCES "WmsStocktake"("organizationId", "workspaceId", "warehouseId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsStocktakeLocation" ADD CONSTRAINT "WmsStocktakeLocation_location_fkey" FOREIGN KEY ("organizationId", "workspaceId", "warehouseId", "locationId") REFERENCES "WmsLocation"("organizationId", "workspaceId", "warehouseId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsStocktakeLine" ADD CONSTRAINT "WmsStocktakeLine_organizationId_workspaceId_stocktakeId_lo_fkey" FOREIGN KEY ("organizationId", "workspaceId", "stocktakeId", "locationId") REFERENCES "WmsStocktakeLocation"("organizationId", "workspaceId", "stocktakeId", "locationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsStocktakeLine" ADD CONSTRAINT "WmsStocktakeLine_organizationId_workspaceId_lotId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "lotId") REFERENCES "WmsLot"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsStocktakeLine" ADD CONSTRAINT "WmsStocktakeLine_countedBy_fkey" FOREIGN KEY ("countedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma cannot express these row invariants. Lifecycle transitions, permissions,
-- capture consistency and posting still require the future command service.
ALTER TABLE "WmsStocktake" ADD CONSTRAINT "WmsStocktake_metadata_check" CHECK (
  "revision" > 0
  AND (("status" = 'POSTED' AND "postedAt" IS NOT NULL AND "postedCommandId" IS NOT NULL)
    OR ("status" <> 'POSTED' AND "postedAt" IS NULL AND "postedCommandId" IS NULL))
  AND ("status" NOT IN ('COUNTING', 'REVIEW', 'POSTED') OR "startedAt" IS NOT NULL)
  AND ("status" <> 'DRAFT' OR "startedAt" IS NULL)
  AND ("startedAt" IS NULL OR "startedAt" >= "createdAt")
  AND ("postedAt" IS NULL OR "postedAt" >= "startedAt")
);
ALTER TABLE "WmsStocktakeLine" ADD CONSTRAINT "WmsStocktakeLine_baseline_check" CHECK (
  "revision" > 0
  AND "baselineOnHand" >= 0 AND "baselinePendingQc" >= 0
  AND "baselinePendingPutaway" >= 0 AND "baselineRejected" >= 0 AND "baselineReserved" >= 0
  AND "baselinePendingQc"::bigint + "baselinePendingPutaway"::bigint
    + "baselineRejected"::bigint + "baselineReserved"::bigint <= "baselineOnHand"::bigint
  AND (("baselineRevision" IS NOT NULL AND "baselineRevision" > 0)
    OR ("baselineRevision" IS NULL AND "baselineOnHand" = 0))
);
ALTER TABLE "WmsStocktakeLine" ADD CONSTRAINT "WmsStocktakeLine_count_check" CHECK (
  ("countedQty" IS NULL AND "countedBy" IS NULL AND "countedAt" IS NULL)
  OR ("countedQty" IS NOT NULL AND "countedQty" >= 0
    AND "countedBy" IS NOT NULL AND "countedAt" IS NOT NULL)
);
