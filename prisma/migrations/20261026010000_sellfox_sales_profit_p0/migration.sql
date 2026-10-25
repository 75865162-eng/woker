-- Existing sales orders remain NULL. Existing profit snapshots are the all-orders scope.
ALTER TABLE "SellfoxSalesDailySnapshot" ADD COLUMN "orders" INTEGER;
ALTER TABLE "SellfoxProductDailySnapshot" ADD COLUMN "onlySettle" BOOLEAN NOT NULL DEFAULT false;
DROP INDEX "SellfoxProductDailySnapshot_storeId_reportDate_sourceKey_key";
CREATE UNIQUE INDEX "sellfox_profit_scope_key" ON "SellfoxProductDailySnapshot"("storeId", "reportDate", "sourceKey", "onlySettle");

CREATE OR REPLACE VIEW sellfox_sales_daily AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."reportDate", t."asin", t."msku", t."sku", t."quantity", t."revenue", t."currency", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, EXISTS (SELECT 1 FROM "SellfoxSalesDayCoverage" c WHERE c."storeId"=t."storeId" AND c."reportDate"=t."reportDate" AND c."capturedAt"=t."syncedAt") AS complete, t."orders" FROM "SellfoxSalesDailySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";

CREATE OR REPLACE VIEW sellfox_profit_daily AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."reportDate", t."asin", t."msku", t."sku", t."title", t."currency", t."saleQuantity", t."saleRevenue", t."grossProfit", t."grossProfitRate", t."adCost", t."refundRate", t."orderNum", t."netRevenue", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, t."onlySettle" FROM "SellfoxProductDailySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";
