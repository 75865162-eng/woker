-- Add the FBA Inventory Ledger Detailed View as a manually approved report domain.
-- This migration is additive and is only exercised by the disposable offline fixture.
ALTER TABLE "AmazonSyncDataSource" DROP CONSTRAINT "AmazonSource_domain_policy";
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSource_domain_policy" CHECK (
  "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','inventory_events','fulfillment','pricing','brand_analytics','buy_box_history','listing_details','catalog_items')
  AND "freshnessMinutes" BETWEEN 15 AND 43200 AND "rowCount" >= 0
);

ALTER TABLE "AmazonSyncRun" DROP CONSTRAINT "AmazonSyncRun_v2_shape";
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_v2_shape" CHECK (
  "executionVersion" <> 2 OR (
    "sourceId" IS NOT NULL
    AND "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','inventory_events','fulfillment','pricing','brand_analytics','buy_box_history','listing_details','catalog_items')
    AND (("resource" = 'sales_traffic' AND "mode" = 'date_range')
      OR ("resource" IN ('inventory','catalog','fulfillment','pricing','listing_details','catalog_items') AND "mode" = 'snapshot')
      OR ("resource" IN ('orders','finance','returns') AND "mode" = 'incremental')
      OR ("resource" IN ('settlements','reimbursements','inventory_age','inventory_events','brand_analytics','buy_box_history') AND "mode" = 'report'))
    AND "attempts" >= 0 AND "maxAttempts" >= 1 AND "pagesCompleted" >= 0
    AND "processedCount" >= 0 AND "insertedCount" >= 0 AND "skippedCount" >= 0
    AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED','SUCCEEDED','PARTIAL_SUCCESS','FAILED','CANCELLED','BLOCKED')
  )
);

ALTER TABLE "AmazonSyncReportDocument" DROP CONSTRAINT "AmazonReport_resource_type_check";
ALTER TABLE "AmazonSyncReportDocument" ADD CONSTRAINT "AmazonReport_resource_type_check" CHECK (
  ("resource" = 'settlements' AND "reportType" = 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2') OR
  ("resource" = 'reimbursements' AND "reportType" = 'GET_FBA_REIMBURSEMENTS_DATA') OR
  ("resource" = 'inventory_age' AND "reportType" = 'GET_FBA_INVENTORY_PLANNING_DATA') OR
  ("resource" = 'inventory_events' AND "reportType" = 'GET_LEDGER_DETAIL_VIEW_DATA')
);
