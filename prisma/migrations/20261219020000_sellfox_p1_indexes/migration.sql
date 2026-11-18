-- P1 3.1 / 3.6: closing the LATERAL asin-match index gap.
-- workbench-read.ts base CTE matches listing candidates by (storeId, asin) in the
-- LATERAL subquery. Existing indexes cover (org,ws,storeId,msku,capturedAt) and
-- (org,ws,asin) but not the store+asin+capturedAt combination the LATERAL needs.
-- This is additive DDL: no data rewrite, no口径 change, no column type change.
CREATE INDEX IF NOT EXISTS "sellfox_listing_lateral_asin"
  ON "SellfoxListingSnapshot" ("organizationId", "workspaceId", "storeId", "asin", "capturedAt");

-- coverage 落列后视图已不再逐行扫 coverage 表；但同步回填、对账脚本仍按
-- (storeId, reportDate, capturedAt) 关联，补一个覆盖索引避免这些批量路径 Seq Scan。
CREATE INDEX IF NOT EXISTS "sellfox_sales_day_coverage_batch"
  ON "SellfoxSalesDayCoverage" ("storeId", "reportDate", "capturedAt");
