-- Nullable detail fields: existing rows and all source/task identities remain intact.
ALTER TABLE "AmazonOrderRecord"
  ADD COLUMN "fulfilledBy" TEXT,
  ADD COLUMN "fulfillmentServiceLevel" TEXT;
