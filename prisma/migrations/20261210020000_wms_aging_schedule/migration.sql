CREATE TABLE "WmsAgingSchedule" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL,
 "workspaceId" TEXT NOT NULL,
 "warehouseId" TEXT NOT NULL,
 "actorUserId" TEXT NOT NULL,
 "policyReference" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT false,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK (revision>0),
 "nextRunAt" TIMESTAMPTZ(3) NOT NULL,
 "lastSucceededAt" TIMESTAMPTZ(3),
 "lastError" TEXT,
 CONSTRAINT "WmsAgingSchedule_warehouse_fkey" FOREIGN KEY ("organizationId","workspaceId","warehouseId") REFERENCES "WmsWarehouse"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "WmsAgingSchedule_warehouse_key" ON "WmsAgingSchedule"("organizationId","workspaceId","warehouseId");
CREATE INDEX "WmsAgingSchedule_due_idx" ON "WmsAgingSchedule"(enabled,"nextRunAt");
ALTER TABLE "WmsAgingSnapshot" ADD CONSTRAINT "WmsAgingSnapshot_warehouse_fkey" FOREIGN KEY ("organizationId","workspaceId","warehouseId") REFERENCES "WmsWarehouse"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "FinanceVoucherLine_bank_scope_key" ON "FinanceVoucherLine"("organizationId","workspaceId","bookId",id);
ALTER TABLE "FinanceBankMatchEntry" DROP CONSTRAINT "FinanceBankMatchEntry_line_fkey";
ALTER TABLE "FinanceBankMatchEntry" ADD CONSTRAINT "FinanceBankMatchEntry_line_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId","voucherLineId") REFERENCES "FinanceVoucherLine"("organizationId","workspaceId","bookId",id) ON DELETE RESTRICT ON UPDATE RESTRICT;
