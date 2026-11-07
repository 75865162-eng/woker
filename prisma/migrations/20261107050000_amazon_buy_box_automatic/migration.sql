-- Add automatic Buy Box support; preserves every existing source, task and fact.
ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT "AmazonSchedule_supported_enabled";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_supported_enabled" CHECK (
  NOT "enabled" OR "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','inventory_events','fulfillment','listing_details','catalog_items','pricing','brand_analytics','buy_box_history','notifications')
);
ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT "AmazonSchedule_v2_policy";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_v2_policy" CHECK (
  "executionVersion" <> 2 OR (
    (("resource" = 'sales_traffic' AND "mode" = 'date_range')
      OR ("resource" IN ('inventory','catalog','fulfillment','listing_details','catalog_items','pricing','brand_analytics','buy_box_history','notifications') AND "mode" = 'snapshot')
      OR ("resource" IN ('orders','finance','returns','settlements','reimbursements','inventory_age','inventory_events') AND "mode" = 'incremental'))
    AND "intervalMinutes" BETWEEN 15 AND 10080
    AND "maxAttempts" BETWEEN 1 AND 10
    AND "priority" BETWEEN 1 AND 4
    AND "retentionDays" BETWEEN 1 AND 3650
  )
);

-- Read-only seller subscription observations; preserves existing resource checks.
ALTER TABLE "AmazonSyncDataSource" DROP CONSTRAINT "AmazonSource_domain_policy";
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSource_domain_policy" CHECK (
  "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','inventory_events','fulfillment','pricing','brand_analytics','buy_box_history','listing_details','catalog_items','notifications')
  AND "freshnessMinutes" BETWEEN 15 AND 43200 AND "rowCount" >= 0
);

ALTER TABLE "AmazonSyncRun" DROP CONSTRAINT "AmazonSyncRun_v2_shape";
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_v2_shape" CHECK (
  "executionVersion" <> 2 OR (
    "sourceId" IS NOT NULL
    AND "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','inventory_events','fulfillment','pricing','brand_analytics','buy_box_history','listing_details','catalog_items','notifications')
    AND (("resource" = 'sales_traffic' AND "mode" = 'date_range')
      OR ("resource" IN ('inventory','catalog','fulfillment','pricing','listing_details','catalog_items','notifications') AND "mode" = 'snapshot')
      OR ("resource" IN ('orders','finance','returns') AND "mode" = 'incremental')
      OR ("resource" IN ('settlements','reimbursements','inventory_age','inventory_events','brand_analytics','buy_box_history') AND "mode" = 'report'))
    AND "attempts" >= 0 AND "maxAttempts" >= 1 AND "pagesCompleted" >= 0
    AND "processedCount" >= 0 AND "insertedCount" >= 0 AND "skippedCount" >= 0
    AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED','SUCCEEDED','PARTIAL_SUCCESS','FAILED','CANCELLED','BLOCKED')
  )
);

ALTER TABLE "AmazonDomainObservation" DROP CONSTRAINT "AmazonObservation_kind_check";
ALTER TABLE "AmazonDomainObservation" ADD CONSTRAINT "AmazonObservation_kind_check" CHECK (
  "kind" IN ('INBOUND_PLAN','INBOUND_SHIPMENT','INBOUND_PLAN_ITEM','INBOUND_SHIPMENT_ITEM','COMPETITIVE_PRICE','OWN_PRICE_ASIN','BRAND_SEARCH_TERMS','BRAND_SEARCH_QUERY','BRAND_SEARCH_CATALOG','BRAND_MARKET_BASKET','BRAND_REPEAT_PURCHASE','BUY_BOX_DAY','LISTING_DETAIL','CATALOG_DETAIL','NOTIFICATION_SUBSCRIPTION')
);
