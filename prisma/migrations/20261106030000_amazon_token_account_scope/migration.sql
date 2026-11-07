-- Account-scoped business keys support self-authorized tokens without fabricating a Seller ID.
-- No facts, cursors, credentials or ownership mappings are changed. New indexes are
-- created before old ones are dropped; a duplicate aborts this transaction.
BEGIN;
ALTER INDEX "AmazonOrder_scope_business_key" RENAME TO "AmazonOrder_seller_id_legacy_key";
ALTER INDEX "AmazonFinance_business_key" RENAME TO "AmazonFinance_seller_id_legacy_key";
ALTER INDEX "AmazonReturn_business_key" RENAME TO "AmazonReturn_seller_id_legacy_key";
CREATE UNIQUE INDEX "AmazonOrder_scope_business_key" ON "AmazonOrderRecord"("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "amazonOrderId");
CREATE UNIQUE INDEX "AmazonFinance_business_key" ON "AmazonFinanceRecord"("organizationId", "workspaceId", "sellerAccountId", "transactionId");
CREATE UNIQUE INDEX "AmazonReturn_business_key" ON "AmazonReturnRecord"("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "reportId", "rowHash");
COMMIT;
