-- Enable automatic plans for the already implemented Amazon data domains.
-- Every scheduled run remains fenced by its enabled plan and live source checks.
ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT IF EXISTS "AmazonSchedule_supported_enabled";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_supported_enabled" CHECK (
  NOT "enabled" OR "resource" IN ('inventory', 'catalog', 'sales_traffic', 'orders', 'finance')
);

ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT "AmazonSchedule_v2_policy";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_v2_policy" CHECK (
  "executionVersion" <> 2 OR (
    "resource" IN ('inventory', 'catalog', 'sales_traffic', 'orders', 'finance')
    AND (("resource" = 'sales_traffic' AND "mode" = 'date_range')
      OR ("resource" IN ('inventory', 'catalog') AND "mode" = 'snapshot')
      OR ("resource" IN ('orders', 'finance') AND "mode" = 'incremental'))
    AND "intervalMinutes" BETWEEN 15 AND 10080
    AND "maxAttempts" BETWEEN 1 AND 10
    AND "priority" BETWEEN 1 AND 4
    AND "retentionDays" BETWEEN 1 AND 3650
  )
);
