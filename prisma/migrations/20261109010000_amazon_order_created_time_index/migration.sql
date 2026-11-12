CREATE INDEX "AmazonOrder_source_created_idx"
ON "AmazonOrderRecord"("organizationId", "workspaceId", "sourceId", "createdTime");
