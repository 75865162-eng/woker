-- Additive capabilities only. No source, plan, task, credential or fact is changed.
-- This migration must be reviewed and deployed before enabling brand collection.
ALTER TABLE "AmazonDomainObservation" DROP CONSTRAINT "AmazonObservation_kind_check";
ALTER TABLE "AmazonDomainObservation" ADD CONSTRAINT "AmazonObservation_kind_check" CHECK (
  "kind" IN ('INBOUND_PLAN','INBOUND_SHIPMENT','INBOUND_PLAN_ITEM','INBOUND_SHIPMENT_ITEM','COMPETITIVE_PRICE','OWN_PRICE_ASIN','BRAND_SEARCH_TERMS','BRAND_SEARCH_QUERY','BRAND_SEARCH_CATALOG','BRAND_MARKET_BASKET','BRAND_REPEAT_PURCHASE','BUY_BOX_DAY','LISTING_DETAIL','CATALOG_DETAIL')
);
ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT "AmazonSchedule_supported_enabled";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_supported_enabled" CHECK (
  NOT "enabled" OR "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','inventory_events','fulfillment','listing_details','catalog_items','pricing','brand_analytics')
);
ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT "AmazonSchedule_v2_policy";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_v2_policy" CHECK (
  "executionVersion" <> 2 OR (
    (("resource" = 'sales_traffic' AND "mode" = 'date_range')
      OR ("resource" IN ('inventory','catalog','fulfillment','listing_details','catalog_items','pricing','brand_analytics') AND "mode" = 'snapshot')
      OR ("resource" IN ('orders','finance','returns','settlements','reimbursements','inventory_age','inventory_events') AND "mode" = 'incremental'))
    AND "intervalMinutes" BETWEEN 15 AND 10080
    AND "maxAttempts" BETWEEN 1 AND 10
    AND "priority" BETWEEN 1 AND 4
    AND "retentionDays" BETWEEN 1 AND 3650
  )
);
