-- Add organization and user ownership to file and job records.
ALTER TABLE "FileObject" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "FileObject" ADD COLUMN "userId" TEXT;
ALTER TABLE "ImportJob" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ImportJob" ADD COLUMN "userId" TEXT;

-- Existing local-first records had no owner metadata. Keep them reachable in the
-- default local tenant, while new records are written from the authenticated user.
UPDATE "FileObject"
SET "organizationId" = 'local-organization',
    "userId" = 'local-admin'
WHERE "organizationId" IS NULL OR "userId" IS NULL;

UPDATE "ImportJob"
SET "organizationId" = "FileObject"."organizationId",
    "userId" = "FileObject"."userId"
FROM "FileObject"
WHERE "ImportJob"."fileId" = "FileObject"."id"
  AND ("ImportJob"."organizationId" IS NULL OR "ImportJob"."userId" IS NULL);

ALTER TABLE "FileObject" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "FileObject" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ImportJob" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ImportJob" ALTER COLUMN "userId" SET NOT NULL;

CREATE TABLE "ExportRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "resultKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FileObject_organizationId_createdAt_idx" ON "FileObject"("organizationId", "createdAt");
CREATE INDEX "FileObject_userId_createdAt_idx" ON "FileObject"("userId", "createdAt");
CREATE INDEX "ImportJob_organizationId_createdAt_idx" ON "ImportJob"("organizationId", "createdAt");
CREATE INDEX "ImportJob_userId_createdAt_idx" ON "ImportJob"("userId", "createdAt");
CREATE UNIQUE INDEX "ExportRecord_jobId_resultKey_key" ON "ExportRecord"("jobId", "resultKey");
CREATE INDEX "ExportRecord_organizationId_createdAt_idx" ON "ExportRecord"("organizationId", "createdAt");
CREATE INDEX "ExportRecord_userId_createdAt_idx" ON "ExportRecord"("userId", "createdAt");
CREATE INDEX "ExportRecord_fileId_idx" ON "ExportRecord"("fileId");

ALTER TABLE "ExportRecord" ADD CONSTRAINT "ExportRecord_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExportRecord" ADD CONSTRAINT "ExportRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
