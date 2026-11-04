-- Nullable additions preserve existing authorizations and last successful validation.
ALTER TABLE "AmazonSpApiAuthorization"
  ADD COLUMN "validationAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "validationErrorCode" TEXT;
