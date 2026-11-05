-- The client identity is represented only by a SHA-256 digest, never a credential.
CREATE TABLE "AmazonAdsApiBudget" (
  "clientIdHash" TEXT NOT NULL,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "operation" TEXT,
  "nextRequestAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastRequestAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsApiBudget_pkey" PRIMARY KEY ("clientIdHash")
);
CREATE INDEX "AmazonAdsApiBudget_lease_idx" ON "AmazonAdsApiBudget"("leaseExpiresAt");
CREATE INDEX "AmazonAdsApiBudget_next_request_idx" ON "AmazonAdsApiBudget"("nextRequestAt");
