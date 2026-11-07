ALTER TABLE "AmazonAdsProfile" ADD COLUMN "advertiserAccountId" TEXT;
ALTER TABLE "AmazonAdsProfile" ADD COLUMN "advertiserAccountRevision" INTEGER NOT NULL DEFAULT 0;
