-- Wimoor shelf.isfrozen: block location operations without changing inventory buckets.
ALTER TABLE "WmsLocation" ADD COLUMN "frozen" BOOLEAN NOT NULL DEFAULT false;
