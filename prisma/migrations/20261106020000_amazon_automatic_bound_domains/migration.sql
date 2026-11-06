-- Expand existing schedule constraints only; no facts or cursors are rewritten.
ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT "AmazonSchedule_supported_enabled";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_supported_enabled" CHECK (
  NOT "enabled" OR "resource" IN ('inventory', 'catalog', 'sales_traffic', 'orders', 'finance', 'returns', 'settlements', 'reimbursements', 'inventory_age', 'inventory_events', 'fulfillment', 'listing_details', 'catalog_items', 'pricing')
);
ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT "AmazonSchedule_v2_policy";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_v2_policy" CHECK (
  "executionVersion" <> 2 OR (
    (("resource" = 'sales_traffic' AND "mode" = 'date_range')
      OR ("resource" IN ('inventory', 'catalog', 'fulfillment', 'listing_details', 'catalog_items', 'pricing') AND "mode" = 'snapshot')
      OR ("resource" IN ('orders', 'finance', 'returns', 'settlements', 'reimbursements', 'inventory_age', 'inventory_events') AND "mode" = 'incremental'))
    AND "intervalMinutes" BETWEEN 15 AND 10080
    AND "maxAttempts" BETWEEN 1 AND 10
    AND "priority" BETWEEN 1 AND 4
    AND "retentionDays" BETWEEN 1 AND 3650
  )
);
