ALTER TABLE "ProductRecord" ADD COLUMN "chineseName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "englishName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "asin" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "status" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "supplierName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "purchasePrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ProductRecord" ADD COLUMN "selectionOwner" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "opsAssignee" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "designerAssignee" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "workflowStage" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "workflowDueAt" TIMESTAMP(3);
ALTER TABLE "ProductRecord" ADD COLUMN "operationsProgressIncomplete" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ProductRecord"
SET
  "chineseName" = COALESCE("payload"->>'chineseName', ''),
  "englishName" = COALESCE("payload"->>'englishName', ''),
  "asin" = COALESCE("payload"->>'asin', ''),
  "status" = COALESCE("payload"->>'status', ''),
  "supplierName" = COALESCE("payload"->>'supplierName', ''),
  "purchasePrice" = CASE
    WHEN COALESCE("payload"->>'purchasePrice', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN ("payload"->>'purchasePrice')::DOUBLE PRECISION
    ELSE 0
  END,
  "selectionOwner" = COALESCE(NULLIF("payload"->>'selectionOwner', ''), "payload"->>'developer', ''),
  "opsAssignee" = COALESCE(NULLIF("payload"->>'opsAssignee', ''), array_to_string(ARRAY(
    SELECT jsonb_array_elements_text(CASE
      WHEN jsonb_typeof("payload"->'opsAssignees') = 'array' THEN "payload"->'opsAssignees'
      ELSE '[]'::jsonb
    END)
  ), ','), ''),
  "designerAssignee" = COALESCE(NULLIF("payload"->>'designerAssignee', ''), array_to_string(ARRAY(
    SELECT jsonb_array_elements_text(CASE
      WHEN jsonb_typeof("payload"->'designerAssignees') = 'array' THEN "payload"->'designerAssignees'
      ELSE '[]'::jsonb
    END)
  ), ','), ''),
  "workflowStage" = COALESCE(NULLIF("payload"->>'workflowStage', ''), CASE
    WHEN "payload"->>'status' = 'ops_review' THEN 'ops_confirming'
    WHEN "payload"->>'status' = 'design_in_progress' THEN 'design_in_progress'
    WHEN "payload"->>'status' = 'listing_confirming' THEN 'design_review'
    WHEN "payload"->>'status' = 'listed' THEN 'done'
    WHEN "payload"->>'status' IN ('canceled', 'delisted', 'patent_risk') THEN 'blocked'
    ELSE 'selection_pending'
  END),
  "workflowDueAt" = CASE
    WHEN COALESCE("payload"->>'workflowDueAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      THEN ("payload"->>'workflowDueAt')::TIMESTAMP
    ELSE NULL
  END,
  "operationsProgressIncomplete" = EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE
      WHEN jsonb_typeof("payload"->'operationsProgress'->'stages') = 'array' THEN "payload"->'operationsProgress'->'stages'
      ELSE '[]'::jsonb
    END) AS stage
    WHERE stage->>'status' <> 'completed'
  );

CREATE INDEX "ProductRecord_organizationId_workspaceId_chineseName_idx" ON "ProductRecord"("organizationId", "workspaceId", "chineseName");
CREATE INDEX "ProductRecord_organizationId_workspaceId_asin_idx" ON "ProductRecord"("organizationId", "workspaceId", "asin");
CREATE INDEX "ProductRecord_organizationId_workspaceId_status_idx" ON "ProductRecord"("organizationId", "workspaceId", "status");
CREATE INDEX "ProductRecord_organizationId_workspaceId_supplierName_idx" ON "ProductRecord"("organizationId", "workspaceId", "supplierName");
CREATE INDEX "ProductRecord_organizationId_workspaceId_purchasePrice_idx" ON "ProductRecord"("organizationId", "workspaceId", "purchasePrice");
CREATE INDEX "ProductRecord_organizationId_workspaceId_selectionOwner_idx" ON "ProductRecord"("organizationId", "workspaceId", "selectionOwner");
CREATE INDEX "ProductRecord_organizationId_workspaceId_opsAssignee_idx" ON "ProductRecord"("organizationId", "workspaceId", "opsAssignee");
CREATE INDEX "ProductRecord_organizationId_workspaceId_designerAssignee_idx" ON "ProductRecord"("organizationId", "workspaceId", "designerAssignee");
CREATE INDEX "ProductRecord_organizationId_workspaceId_workflowStage_idx" ON "ProductRecord"("organizationId", "workspaceId", "workflowStage");
CREATE INDEX "ProductRecord_organizationId_workspaceId_workflowDueAt_idx" ON "ProductRecord"("organizationId", "workspaceId", "workflowDueAt");
CREATE INDEX "ProductRecord_organizationId_workspaceId_operationsProgressIncomplete_idx" ON "ProductRecord"("organizationId", "workspaceId", "operationsProgressIncomplete");
