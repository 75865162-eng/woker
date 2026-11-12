ALTER TABLE "WmsReceiptLine" ADD COLUMN "returnedQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WmsReceiptLine" ADD CONSTRAINT "WmsReceiptLine_returnedQty_check"
  CHECK ("returnedQty" >= 0 AND "returnedQty" <= "rejectedQty");
