CREATE TABLE "WmsWarehouseType" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "name" TEXT NOT NULL CHECK(length(trim("name")) BETWEEN 1 AND 120), "remark" TEXT,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK("revision">0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("organizationId","workspaceId","id"), UNIQUE("organizationId","workspaceId","name"),
 FOREIGN KEY("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
ALTER TABLE "WmsWarehouse" ADD COLUMN "typeId" TEXT;
ALTER TABLE "WmsWarehouse" ADD CONSTRAINT "WmsWarehouse_type_scope_fk" FOREIGN KEY("organizationId","workspaceId","typeId") REFERENCES "WmsWarehouseType"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "WmsWarehouseAddress" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "warehouseId" TEXT NOT NULL,
 "label" TEXT NOT NULL CHECK(length(trim("label")) BETWEEN 1 AND 120),
 "countryCode" TEXT NOT NULL CHECK("countryCode" ~ '^[A-Z]{2}$'), "region" TEXT, "city" TEXT NOT NULL,
 "addressLine1" TEXT NOT NULL, "addressLine2" TEXT, "postalCode" TEXT NOT NULL, "contactName" TEXT NOT NULL, "phone" TEXT,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK("revision">0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("organizationId","workspaceId","id"), UNIQUE("organizationId","workspaceId","warehouseId","label"),
 FOREIGN KEY("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("organizationId","workspaceId","warehouseId") REFERENCES "WmsWarehouse"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
ALTER TABLE "WmsLocation" ADD COLUMN "lengthCm" DECIMAL(18,6), ADD COLUMN "widthCm" DECIMAL(18,6), ADD COLUMN "heightCm" DECIMAL(18,6), ADD COLUMN "capacityCubicMeters" DECIMAL(18,6);
ALTER TABLE "WmsLocation" ADD CONSTRAINT "WmsLocation_dimensions_positive" CHECK(
 ("lengthCm" IS NULL OR "lengthCm">0) AND ("widthCm" IS NULL OR "widthCm">0) AND ("heightCm" IS NULL OR "heightCm">0) AND ("capacityCubicMeters" IS NULL OR "capacityCubicMeters">0));
CREATE TABLE "WmsOutboundConsumable" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "warehouseId" TEXT NOT NULL,
 "outboundLineId" TEXT NOT NULL, "productRecordId" TEXT NOT NULL, "units" DECIMAL(18,6) NOT NULL CHECK("units">0),
 "accountedMainQty" INTEGER NOT NULL DEFAULT 0 CHECK("accountedMainQty">=0), "issuedQty" INTEGER NOT NULL DEFAULT 0 CHECK("issuedQty">=0),
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK("revision">0), "createdBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WmsOutboundConsumable_exact_issue" CHECK("issuedQty"="units"*"accountedMainQty"),
 UNIQUE("organizationId","workspaceId","id"), UNIQUE("organizationId","workspaceId","outboundLineId","productRecordId"),
 FOREIGN KEY("organizationId","workspaceId","warehouseId","outboundLineId") REFERENCES "WmsOutboundLine"("organizationId","workspaceId","warehouseId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("organizationId","workspaceId","productRecordId") REFERENCES "ProductRecord"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "WmsOutboundConsumable_scope_created_idx" ON "WmsOutboundConsumable"("organizationId","workspaceId","createdAt","id");
-- One full compensating conversion per original command. Original movements remain immutable.
CREATE UNIQUE INDEX "WmsCommand_conversion_reversal_key" ON "WmsCommand"("organizationId","workspaceId",("result"->>'reversesCommandId')) WHERE "action"='SKU_CONVERSION_REVERSE';
CREATE INDEX "WmsTransferOrderLine_target_transit_idx" ON "WmsTransferOrderLine"("organizationId","workspaceId","targetWarehouseId","targetLocationId") WHERE "shippedQty">"receivedQty";
