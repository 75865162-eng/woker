-- Additive external facts. Apply only to an explicitly approved target database.
ALTER TABLE "AmazonSyncDataSource" ADD COLUMN "domainPolicy" JSONB;
-- Add settlement discovery, FBA reimbursements, and inventory-age report facts.
-- This is an additive migration; report/source execution stays behind current approval gates.
ALTER TABLE "AmazonSyncDataSource" DROP CONSTRAINT "AmazonSource_domain_policy";
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSource_domain_policy" CHECK (
  "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','fulfillment','pricing','brand_analytics','buy_box_history','listing_details','catalog_items')
  AND "freshnessMinutes" BETWEEN 15 AND 43200 AND "rowCount" >= 0
);

ALTER TABLE "AmazonSyncRun" DROP CONSTRAINT "AmazonSyncRun_v2_shape";
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_v2_shape" CHECK (
  "executionVersion" <> 2 OR (
    "sourceId" IS NOT NULL
    AND "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','fulfillment','pricing','brand_analytics','buy_box_history','listing_details','catalog_items')
    AND (("resource" = 'sales_traffic' AND "mode" = 'date_range')
      OR ("resource" IN ('inventory','catalog','fulfillment','pricing','listing_details','catalog_items') AND "mode" = 'snapshot')
      OR ("resource" IN ('orders','finance','returns') AND "mode" = 'incremental')
      OR ("resource" IN ('settlements','reimbursements','inventory_age','brand_analytics','buy_box_history') AND "mode" = 'report'))
    AND "attempts" >= 0 AND "maxAttempts" >= 1 AND "pagesCompleted" >= 0
    AND "processedCount" >= 0 AND "insertedCount" >= 0 AND "skippedCount" >= 0
    AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED','SUCCEEDED','PARTIAL_SUCCESS','FAILED','CANCELLED','BLOCKED')
  )
);


CREATE TABLE "AmazonDomainObservation" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "sourceId" TEXT NOT NULL, "sourceRunId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "businessKey" TEXT NOT NULL, "asin" TEXT, "sellerSku" TEXT, "searchTerm" TEXT,
 "facts" JSONB NOT NULL, "capturedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "AmazonObservation_kind_check" CHECK ("kind" IN ('INBOUND_PLAN','INBOUND_SHIPMENT','INBOUND_PLAN_ITEM','INBOUND_SHIPMENT_ITEM','COMPETITIVE_PRICE','OWN_PRICE_ASIN','BRAND_SEARCH_TERMS','BRAND_SEARCH_QUERY','BRAND_SEARCH_CATALOG','BRAND_MARKET_BASKET','BUY_BOX_DAY','LISTING_DETAIL','CATALOG_DETAIL')),
 CONSTRAINT "AmazonObservation_run_key" UNIQUE ("sourceRunId", "kind", "businessKey"),
 CONSTRAINT "AmazonObservation_source_fkey" FOREIGN KEY ("organizationId","workspaceId","sourceId") REFERENCES "AmazonSyncDataSource" ("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AmazonObservation_run_fkey" FOREIGN KEY ("sourceRunId","organizationId","workspaceId","sourceId") REFERENCES "AmazonSyncRun" ("id","organizationId","workspaceId","sourceId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AmazonObservation_scope_idx" ON "AmazonDomainObservation" ("organizationId","workspaceId","sourceId","sourceRunId","kind");
CREATE INDEX "AmazonObservation_asin_idx" ON "AmazonDomainObservation" ("organizationId","workspaceId","sourceId","asin");
