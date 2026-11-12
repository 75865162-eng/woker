ALTER TABLE "WmsReservation"
  ADD COLUMN "outboundWarehouseId" TEXT,
  ADD COLUMN "outboundLineId" TEXT,
  ADD CONSTRAINT "WmsReservation_outbound_link_check" CHECK (("outboundWarehouseId" IS NULL) = ("outboundLineId" IS NULL));

CREATE UNIQUE INDEX "WmsOutboundLine_scope_warehouse_key"
  ON "WmsOutboundLine"("organizationId", "workspaceId", "warehouseId", "id");

CREATE INDEX "WmsReservation_outbound_line_idx"
  ON "WmsReservation"("organizationId", "workspaceId", "outboundWarehouseId", "outboundLineId");

ALTER TABLE "WmsReservation"
  ADD CONSTRAINT "WmsReservation_outbound_line_fkey"
  FOREIGN KEY ("organizationId", "workspaceId", "outboundWarehouseId", "outboundLineId")
  REFERENCES "WmsOutboundLine"("organizationId", "workspaceId", "warehouseId", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
