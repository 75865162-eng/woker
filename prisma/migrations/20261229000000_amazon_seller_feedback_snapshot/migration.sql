-- Additive only. Seller Feedback Report (GET_SELLER_FEEDBACK_DATA) TSV details.
-- Order-level feedback facts; append-style snapshots with content-idempotent rows.
-- Buyer e-mail is PII and stays only inside the sealed raw envelope, never a column.
-- Manual review and separate execution approval required.
CREATE TABLE IF NOT EXISTS "AmazonSellerFeedbackSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "sellerAccountId" TEXT NOT NULL,
  "marketplaceId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "feedbackDate" VARCHAR(10) NOT NULL,
  "rating" INTEGER NOT NULL,
  "comments" TEXT NOT NULL,
  "response" TEXT NOT NULL,
  "amazonOrderId" VARCHAR(30),
  "capturedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonSellerFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonSellerFeedback_task_fkey" FOREIGN KEY ("syncRunId", "organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncRun" ("id", "organizationId", "workspaceId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonSellerFeedback_source_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource" ("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonSellerFeedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "AmazonSellerFeedback_date_check" CHECK ("feedbackDate" ~ '^\d{4}-\d{2}-\d{2}$')
);
CREATE INDEX IF NOT EXISTS "AmazonSellerFeedback_scope_date_idx" ON "AmazonSellerFeedbackSnapshot" ("organizationId", "workspaceId", "sourceId", "feedbackDate");
CREATE INDEX IF NOT EXISTS "AmazonSellerFeedback_order_idx" ON "AmazonSellerFeedbackSnapshot" ("organizationId", "workspaceId", "amazonOrderId");
CREATE INDEX IF NOT EXISTS "AmazonSellerFeedback_rating_idx" ON "AmazonSellerFeedbackSnapshot" ("organizationId", "workspaceId", "rating", "feedbackDate");
