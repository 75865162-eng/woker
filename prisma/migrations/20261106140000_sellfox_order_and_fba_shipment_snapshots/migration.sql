-- Sellfox order lines and FBA shipment lines. Read models only; ProductRecord is unchanged.

CREATE TABLE "SellfoxOrderSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "storeId" TEXT NOT NULL,
    "shopExternalId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "sellerOrderId" TEXT,
    "asin" TEXT NOT NULL DEFAULT '',
    "msku" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "orderStatus" TEXT NOT NULL,
    "purchaseDate" TEXT,
    "purchaseDateRaw" TEXT,
    "payAt" TEXT,
    "refundAt" TEXT,
    "currency" TEXT,
    "orderTotal" DOUBLE PRECISION,
    "qty" INTEGER,
    "refundQty" INTEGER,
    "itemAmount" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "promo" TEXT,
    "shipServiceLevel" TEXT,
    "fulfillmentChannel" TEXT NOT NULL DEFAULT '',
    "address" JSONB,
    "latestCapturedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellfoxOrderSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellfoxFbaShipmentSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "storeId" TEXT NOT NULL,
    "shopExternalId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "shipmentName" TEXT,
    "status" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "asin" TEXT NOT NULL DEFAULT '',
    "msku" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "declaredQty" INTEGER,
    "shippedQty" INTEGER,
    "receivedQty" INTEGER,
    "sourceCreatedAt" TEXT,
    "sourceUpdatedAt" TEXT,
    "shippedAt" TEXT,
    "fulfillmentCenterId" TEXT,
    "latestCapturedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellfoxFbaShipmentSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellfoxOrderSnapshot_storeId_orderId_lineKey_key" ON "SellfoxOrderSnapshot"("storeId", "orderId", "lineKey");
CREATE INDEX "SellfoxOrderSnapshot_organizationId_workspaceId_purchaseDate_idx" ON "SellfoxOrderSnapshot"("organizationId", "workspaceId", "purchaseDate");
CREATE INDEX "SellfoxOrderSnapshot_organizationId_workspaceId_orderStatus_idx" ON "SellfoxOrderSnapshot"("organizationId", "workspaceId", "orderStatus");
CREATE INDEX "SellfoxOrderSnapshot_organizationId_workspaceId_asin_idx" ON "SellfoxOrderSnapshot"("organizationId", "workspaceId", "asin");
CREATE INDEX "SellfoxOrderSnapshot_organizationId_workspaceId_msku_idx" ON "SellfoxOrderSnapshot"("organizationId", "workspaceId", "msku");
CREATE INDEX "SellfoxOrderSnapshot_organizationId_workspaceId_orderId_idx" ON "SellfoxOrderSnapshot"("organizationId", "workspaceId", "orderId");

CREATE UNIQUE INDEX "SellfoxFbaShipmentSnapshot_storeId_shipmentId_lineKey_key" ON "SellfoxFbaShipmentSnapshot"("storeId", "shipmentId", "lineKey");
CREATE INDEX "SellfoxFbaShipmentSnapshot_organizationId_workspaceId_status_idx" ON "SellfoxFbaShipmentSnapshot"("organizationId", "workspaceId", "status");
CREATE INDEX "SellfoxFbaShipmentSnapshot_organizationId_workspaceId_storeId_latestCapturedAt_idx" ON "SellfoxFbaShipmentSnapshot"("organizationId", "workspaceId", "storeId", "latestCapturedAt");
CREATE INDEX "SellfoxFbaShipmentSnapshot_organizationId_workspaceId_msku_idx" ON "SellfoxFbaShipmentSnapshot"("organizationId", "workspaceId", "msku");
CREATE INDEX "SellfoxFbaShipmentSnapshot_organizationId_workspaceId_asin_idx" ON "SellfoxFbaShipmentSnapshot"("organizationId", "workspaceId", "asin");

ALTER TABLE "SellfoxOrderSnapshot" ADD CONSTRAINT "SellfoxOrderSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellfoxFbaShipmentSnapshot" ADD CONSTRAINT "SellfoxFbaShipmentSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
