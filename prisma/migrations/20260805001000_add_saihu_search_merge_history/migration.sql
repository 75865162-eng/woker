CREATE TABLE "SaihuSearchMergeHistoryRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "sourceFileName" TEXT NOT NULL,
  "outputFileName" TEXT,
  "summary" JSONB NOT NULL,
  "rows" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SaihuSearchMergeHistoryRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaihuSearchMergeHistoryRecord_organizationId_createdAt_idx" ON "SaihuSearchMergeHistoryRecord"("organizationId", "createdAt");
CREATE INDEX "SaihuSearchMergeHistoryRecord_userId_createdAt_idx" ON "SaihuSearchMergeHistoryRecord"("userId", "createdAt");

ALTER TABLE "SaihuSearchMergeHistoryRecord"
  ADD CONSTRAINT "SaihuSearchMergeHistoryRecord_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
