-- Register the FBA overage-fee estimate snapshot in the existing sync constraints.
ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT "AmazonSchedule_supported_enabled";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_supported_enabled" CHECK (
  NOT "enabled" OR "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','removal_order_report','removal_shipment_report','fba_shipments','fba_customer_sales','mfn_returns','fba_inventory_by_country','storage_fees','long_term_storage_fees','fba_overage_fees','fba_fulfilled_inventory','fba_inventory_report','reserved_inventory','stranded_inventory','recommended_removals','inventory_events','fulfillment','listing_details','catalog_items','pricing','brand_analytics','buy_box_history','notifications','promotions')
);

ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT "AmazonSchedule_v2_policy";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_v2_policy" CHECK (
  "executionVersion" <> 2 OR (
    (("resource" = 'sales_traffic' AND "mode" = 'date_range')
      OR ("resource" IN ('inventory','catalog','fulfillment','listing_details','catalog_items','pricing','brand_analytics','buy_box_history','notifications','promotions') AND "mode" = 'snapshot')
      OR ("resource" IN ('orders','finance','returns','settlements','reimbursements','inventory_age','removal_order_report','removal_shipment_report','fba_shipments','fba_customer_sales','mfn_returns','fba_inventory_by_country','storage_fees','long_term_storage_fees','fba_overage_fees','fba_fulfilled_inventory','fba_inventory_report','reserved_inventory','stranded_inventory','recommended_removals','inventory_events') AND "mode" = 'incremental'))
    AND "intervalMinutes" BETWEEN 15 AND 10080
    AND "maxAttempts" BETWEEN 1 AND 10
    AND "priority" BETWEEN 1 AND 4
    AND "retentionDays" BETWEEN 1 AND 3650
  )
);

ALTER TABLE "AmazonSyncDataSource" DROP CONSTRAINT "AmazonSource_domain_policy";
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSource_domain_policy" CHECK (
  "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','removal_order_report','removal_shipment_report','fba_shipments','fba_customer_sales','mfn_returns','fba_inventory_by_country','storage_fees','long_term_storage_fees','fba_overage_fees','fba_fulfilled_inventory','fba_inventory_report','reserved_inventory','stranded_inventory','recommended_removals','inventory_events','fulfillment','pricing','brand_analytics','buy_box_history','listing_details','catalog_items','notifications','promotions')
  AND "freshnessMinutes" BETWEEN 15 AND 43200 AND "rowCount" >= 0
);

ALTER TABLE "AmazonSyncRun" DROP CONSTRAINT "AmazonSyncRun_v2_shape";
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_v2_shape" CHECK (
  "executionVersion" <> 2 OR (
    "sourceId" IS NOT NULL
    AND "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age','removal_order_report','removal_shipment_report','fba_shipments','fba_customer_sales','mfn_returns','fba_inventory_by_country','storage_fees','long_term_storage_fees','fba_overage_fees','fba_fulfilled_inventory','fba_inventory_report','reserved_inventory','stranded_inventory','recommended_removals','inventory_events','fulfillment','pricing','brand_analytics','buy_box_history','listing_details','catalog_items','notifications','promotions')
    AND (("resource" = 'sales_traffic' AND "mode" = 'date_range')
      OR ("resource" IN ('inventory','catalog','fulfillment','pricing','listing_details','catalog_items','notifications','promotions') AND "mode" = 'snapshot')
      OR ("resource" IN ('orders','finance','returns') AND "mode" = 'incremental')
      OR ("resource" IN ('settlements','reimbursements','inventory_age','removal_order_report','removal_shipment_report','fba_shipments','fba_customer_sales','mfn_returns','fba_inventory_by_country','storage_fees','long_term_storage_fees','fba_overage_fees','fba_fulfilled_inventory','fba_inventory_report','reserved_inventory','stranded_inventory','recommended_removals','inventory_events','brand_analytics','buy_box_history') AND "mode" = 'report'))
    AND "attempts" >= 0 AND "maxAttempts" >= 1 AND "pagesCompleted" >= 0
    AND "processedCount" >= 0 AND "insertedCount" >= 0 AND "skippedCount" >= 0
    AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED','SUCCEEDED','PARTIAL_SUCCESS','FAILED','CANCELLED','BLOCKED')
  )
);

ALTER TABLE "AmazonSyncReportDocument" DROP CONSTRAINT "AmazonReport_resource_type_check";
ALTER TABLE "AmazonSyncReportDocument" ADD CONSTRAINT "AmazonReport_resource_type_check" CHECK (
  ("resource" = 'settlements' AND "reportType" = 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2')
  OR ("resource" = 'reimbursements' AND "reportType" = 'GET_FBA_REIMBURSEMENTS_DATA')
  OR ("resource" = 'inventory_age' AND "reportType" = 'GET_FBA_INVENTORY_PLANNING_DATA')
  OR ("resource" = 'inventory_events' AND "reportType" = 'GET_LEDGER_DETAIL_VIEW_DATA')
  OR ("resource" = 'fba_inventory_report' AND "reportType" = 'GET_FBA_MYI_ALL_INVENTORY_DATA')
  OR ("resource" = 'removal_shipment_report' AND "reportType" = 'GET_FBA_FULFILLMENT_REMOVAL_SHIPMENT_DETAIL_DATA')
  OR ("resource" = 'removal_order_report' AND "reportType" = 'GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA')
  OR ("resource" = 'long_term_storage_fees' AND "reportType" = 'GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA')
  OR ("resource" = 'storage_fees' AND "reportType" = 'GET_FBA_STORAGE_FEE_CHARGES_DATA')
  OR ("resource" = 'fba_fulfilled_inventory' AND "reportType" = 'GET_AFN_INVENTORY_DATA')
  OR ("resource" = 'reserved_inventory' AND "reportType" = 'GET_RESERVED_INVENTORY_DATA')
  OR ("resource" = 'recommended_removals' AND "reportType" = 'GET_FBA_RECOMMENDED_REMOVAL_DATA')
  OR ("resource" = 'stranded_inventory' AND "reportType" = 'GET_STRANDED_INVENTORY_UI_DATA')
  OR ("resource" = 'fba_shipments' AND "reportType" = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL')
  OR ("resource" = 'fba_customer_sales' AND "reportType" = 'GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA')
  OR ("resource" = 'fba_inventory_by_country' AND "reportType" = 'GET_AFN_INVENTORY_DATA_BY_COUNTRY')
  OR ("resource" = 'mfn_returns' AND "reportType" = 'GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE')
  OR ("resource" = 'fba_overage_fees' AND "reportType" = 'GET_FBA_OVERAGE_FEE_CHARGES_DATA')
);
