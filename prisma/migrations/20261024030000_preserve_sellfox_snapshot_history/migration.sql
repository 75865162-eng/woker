ALTER TABLE "SellfoxHourlyMetric" DROP CONSTRAINT "SellfoxHourlyMetric_storeId_fkey";
ALTER TABLE "SellfoxHourlyMetric" ADD CONSTRAINT "SellfoxHourlyMetric_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SellfoxProductDailySnapshot" DROP CONSTRAINT "SellfoxProductDailySnapshot_storeId_fkey";
ALTER TABLE "SellfoxProductDailySnapshot" ADD CONSTRAINT "SellfoxProductDailySnapshot_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
