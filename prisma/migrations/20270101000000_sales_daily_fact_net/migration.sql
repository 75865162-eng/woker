-- 报告02 生产级补齐：SalesDailyFact 净额列（additive，幂等，兼容存量）
-- netUnits = unitsOrdered - refundUnits；netSales = grossSales - refundAmount
-- 存量行保留 NULL（不臆造历史净额），由后续 upsert 按新口径写入。
ALTER TABLE "SalesDailyFact" ADD COLUMN IF NOT EXISTS "netUnits" INTEGER;
ALTER TABLE "SalesDailyFact" ADD COLUMN IF NOT EXISTS "netSales" DECIMAL(30, 6);
