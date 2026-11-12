-- CreateTable
CREATE TABLE "WmsWarehouse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsArea" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productRecordId" TEXT NOT NULL,
    "lotCode" TEXT NOT NULL,
    "barcode" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "receivingLocationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sourceReference" TEXT,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsReceiptLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "acceptedQty" INTEGER NOT NULL DEFAULT 0,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "putawayQty" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsStockBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "pendingQc" INTEGER NOT NULL DEFAULT 0,
    "pendingPutaway" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsStockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "releasedQty" INTEGER NOT NULL DEFAULT 0,
    "dispatchedQty" INTEGER NOT NULL DEFAULT 0,
    "pickedQty" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsCommand" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WmsCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "balanceId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "action" TEXT NOT NULL,
    "deltaOnHand" INTEGER NOT NULL,
    "deltaPendingQc" INTEGER NOT NULL,
    "deltaPendingPutaway" INTEGER NOT NULL,
    "deltaRejected" INTEGER NOT NULL,
    "deltaReserved" INTEGER NOT NULL,
    "beforeRevision" INTEGER NOT NULL,
    "afterRevision" INTEGER NOT NULL,
    "balanceAfter" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WmsMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "requestHash" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "consumedCommandId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WmsApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WmsWarehouse_organizationId_workspaceId_id_key" ON "WmsWarehouse"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsWarehouse_organizationId_workspaceId_code_key" ON "WmsWarehouse"("organizationId", "workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WmsArea_organizationId_workspaceId_warehouseId_id_key" ON "WmsArea"("organizationId", "workspaceId", "warehouseId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsArea_organizationId_workspaceId_warehouseId_code_key" ON "WmsArea"("organizationId", "workspaceId", "warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WmsLocation_organizationId_workspaceId_warehouseId_id_key" ON "WmsLocation"("organizationId", "workspaceId", "warehouseId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsLocation_organizationId_workspaceId_warehouseId_code_key" ON "WmsLocation"("organizationId", "workspaceId", "warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WmsLot_organizationId_workspaceId_id_key" ON "WmsLot"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsLot_organizationId_workspaceId_productRecordId_lotCode_key" ON "WmsLot"("organizationId", "workspaceId", "productRecordId", "lotCode");

-- CreateIndex
CREATE UNIQUE INDEX "WmsLot_organizationId_workspaceId_barcode_key" ON "WmsLot"("organizationId", "workspaceId", "barcode");

-- CreateIndex
CREATE INDEX "WmsReceipt_organizationId_workspaceId_createdAt_id_idx" ON "WmsReceipt"("organizationId", "workspaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsReceipt_organizationId_workspaceId_id_key" ON "WmsReceipt"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsReceipt_organizationId_workspaceId_number_key" ON "WmsReceipt"("organizationId", "workspaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "WmsReceiptLine_organizationId_workspaceId_receiptId_lotId_key" ON "WmsReceiptLine"("organizationId", "workspaceId", "receiptId", "lotId");

-- CreateIndex
CREATE INDEX "WmsStockBalance_organizationId_workspaceId_warehouseId_crea_idx" ON "WmsStockBalance"("organizationId", "workspaceId", "warehouseId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsStockBalance_organizationId_workspaceId_id_key" ON "WmsStockBalance"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsStockBalance_organizationId_workspaceId_locationId_lotId_key" ON "WmsStockBalance"("organizationId", "workspaceId", "locationId", "lotId");

-- CreateIndex
CREATE INDEX "WmsReservation_organizationId_workspaceId_createdAt_id_idx" ON "WmsReservation"("organizationId", "workspaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsReservation_organizationId_workspaceId_id_key" ON "WmsReservation"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsReservation_organizationId_workspaceId_number_key" ON "WmsReservation"("organizationId", "workspaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "WmsCommand_organizationId_workspaceId_id_key" ON "WmsCommand"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsCommand_organizationId_workspaceId_idempotencyKey_key" ON "WmsCommand"("organizationId", "workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WmsMovement_organizationId_workspaceId_occurredAt_id_idx" ON "WmsMovement"("organizationId", "workspaceId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "WmsMovement_organizationId_workspaceId_balanceId_occurredAt_idx" ON "WmsMovement"("organizationId", "workspaceId", "balanceId", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsMovement_organizationId_workspaceId_commandId_sequence_key" ON "WmsMovement"("organizationId", "workspaceId", "commandId", "sequence");

-- CreateIndex
CREATE INDEX "WmsApproval_organizationId_workspaceId_createdAt_id_idx" ON "WmsApproval"("organizationId", "workspaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsApproval_organizationId_workspaceId_consumedCommandId_key" ON "WmsApproval"("organizationId", "workspaceId", "consumedCommandId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRecord_wms_scope_key" ON "ProductRecord"("organizationId", "workspaceId", "id");

-- AddForeignKey
ALTER TABLE "WmsWarehouse" ADD CONSTRAINT "WmsWarehouse_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsArea" ADD CONSTRAINT "WmsArea_organizationId_workspaceId_warehouseId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "warehouseId") REFERENCES "WmsWarehouse"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsLocation" ADD CONSTRAINT "WmsLocation_organizationId_workspaceId_warehouseId_areaId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "warehouseId", "areaId") REFERENCES "WmsArea"("organizationId", "workspaceId", "warehouseId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsLot" ADD CONSTRAINT "WmsLot_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsLot" ADD CONSTRAINT "WmsLot_organizationId_workspaceId_productRecordId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "productRecordId") REFERENCES "ProductRecord"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsReceipt" ADD CONSTRAINT "WmsReceipt_organizationId_workspaceId_warehouseId_receivin_fkey" FOREIGN KEY ("organizationId", "workspaceId", "warehouseId", "receivingLocationId") REFERENCES "WmsLocation"("organizationId", "workspaceId", "warehouseId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsReceipt" ADD CONSTRAINT "WmsReceipt_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WmsReceiptLine" ADD CONSTRAINT "WmsReceiptLine_organizationId_workspaceId_receiptId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "receiptId") REFERENCES "WmsReceipt"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsReceiptLine" ADD CONSTRAINT "WmsReceiptLine_organizationId_workspaceId_lotId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "lotId") REFERENCES "WmsLot"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsStockBalance" ADD CONSTRAINT "WmsStockBalance_organizationId_workspaceId_warehouseId_loc_fkey" FOREIGN KEY ("organizationId", "workspaceId", "warehouseId", "locationId") REFERENCES "WmsLocation"("organizationId", "workspaceId", "warehouseId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsStockBalance" ADD CONSTRAINT "WmsStockBalance_organizationId_workspaceId_lotId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "lotId") REFERENCES "WmsLot"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsReservation" ADD CONSTRAINT "WmsReservation_organizationId_workspaceId_balanceId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "balanceId") REFERENCES "WmsStockBalance"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsReservation" ADD CONSTRAINT "WmsReservation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WmsCommand" ADD CONSTRAINT "WmsCommand_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsCommand" ADD CONSTRAINT "WmsCommand_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WmsMovement" ADD CONSTRAINT "WmsMovement_organizationId_workspaceId_commandId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "commandId") REFERENCES "WmsCommand"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsMovement" ADD CONSTRAINT "WmsMovement_organizationId_workspaceId_balanceId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "balanceId") REFERENCES "WmsStockBalance"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsMovement" ADD CONSTRAINT "WmsMovement_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WmsApproval" ADD CONSTRAINT "WmsApproval_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WmsApproval" ADD CONSTRAINT "WmsApproval_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WmsApproval" ADD CONSTRAINT "WmsApproval_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WmsApproval" ADD CONSTRAINT "WmsApproval_organizationId_workspaceId_consumedCommandId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "consumedCommandId") REFERENCES "WmsCommand"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Physical stock remains on hand while awaiting inspection, putaway or rejection.
ALTER TABLE "WmsStockBalance" ADD CONSTRAINT "WmsStockBalance_quantities_check" CHECK (
  "onHand" >= 0 AND "pendingQc" >= 0 AND "pendingPutaway" >= 0 AND rejected >= 0 AND reserved >= 0
  AND "pendingQc"::bigint + "pendingPutaway"::bigint + rejected::bigint + reserved::bigint <= "onHand"::bigint
  AND revision > 0
);
ALTER TABLE "WmsReceiptLine" ADD CONSTRAINT "WmsReceiptLine_quantities_check" CHECK (
  "expectedQty" > 0 AND "receivedQty" >= 0 AND "receivedQty" <= "expectedQty"
  AND "acceptedQty" >= 0 AND "rejectedQty" >= 0 AND "putawayQty" >= 0
  AND "acceptedQty"::bigint + "rejectedQty"::bigint <= "receivedQty"::bigint
  AND "putawayQty" <= "acceptedQty" AND revision > 0
);
ALTER TABLE "WmsReservation" ADD CONSTRAINT "WmsReservation_quantities_check" CHECK (
  "requestedQty" > 0 AND "releasedQty" >= 0 AND "dispatchedQty" >= 0 AND "pickedQty" >= 0
  AND "releasedQty"::bigint + "dispatchedQty"::bigint + "pickedQty"::bigint <= "requestedQty"::bigint AND revision > 0
);
ALTER TABLE "WmsLocation" ADD CONSTRAINT "WmsLocation_kind_check" CHECK (kind IN ('RECEIVING','STORAGE') AND revision > 0);
ALTER TABLE "WmsReceipt" ADD CONSTRAINT "WmsReceipt_status_check" CHECK (status IN ('DRAFT','RECEIVED','INSPECTED','PUTAWAY','CANCELLED') AND revision > 0);
ALTER TABLE "WmsApproval" ADD CONSTRAINT "WmsApproval_status_check" CHECK (
  status IN ('PENDING','APPROVED','REJECTED','CONSUMED') AND revision > 0
  AND ("approvedBy" IS NULL OR "approvedBy" <> "requestedBy")
  AND (status NOT IN ('APPROVED','REJECTED','CONSUMED') OR "approvedBy" IS NOT NULL)
  AND ((status = 'CONSUMED') = ("consumedCommandId" IS NOT NULL))
);
ALTER TABLE "WmsMovement" ADD CONSTRAINT "WmsMovement_revision_check" CHECK ("afterRevision" = "beforeRevision" + 1 AND "beforeRevision" > 0 AND sequence >= 0);
CREATE FUNCTION wms_reject_movement_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WMS movements are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "WmsMovement_immutable" BEFORE UPDATE OR DELETE ON "WmsMovement"
FOR EACH ROW EXECUTE FUNCTION wms_reject_movement_mutation();
