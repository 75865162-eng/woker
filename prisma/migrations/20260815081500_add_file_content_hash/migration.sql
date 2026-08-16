ALTER TABLE "FileObject" ADD COLUMN "contentHash" TEXT;

CREATE INDEX "FileObject_contentHash_scope_idx"
ON "FileObject"("organizationId", "workspaceId", "accountId", "marketplace", "storageType", "contentHash");
