-- Persist asynchronous image upscale jobs and their processing history.
CREATE TYPE "ImageUpscaleJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE "ImageUpscaleJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "inputKey" TEXT NOT NULL,
    "outputKey" TEXT,
    "status" "ImageUpscaleJobStatus" NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "scale" INTEGER NOT NULL,
    "imageKind" TEXT NOT NULL,
    "noiseLevel" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputWidth" INTEGER,
    "inputHeight" INTEGER,
    "outputWidth" INTEGER,
    "outputHeight" INTEGER,
    "inputSize" INTEGER NOT NULL,
    "outputSize" INTEGER,
    "processingMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImageUpscaleJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImageUpscaleJob_organizationId_createdAt_idx" ON "ImageUpscaleJob"("organizationId", "createdAt");
CREATE INDEX "ImageUpscaleJob_organizationId_batchId_createdAt_idx" ON "ImageUpscaleJob"("organizationId", "batchId", "createdAt");
CREATE INDEX "ImageUpscaleJob_userId_createdAt_idx" ON "ImageUpscaleJob"("userId", "createdAt");
CREATE INDEX "ImageUpscaleJob_status_createdAt_idx" ON "ImageUpscaleJob"("status", "createdAt");

ALTER TABLE "ImageUpscaleJob" ADD CONSTRAINT "ImageUpscaleJob_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageUpscaleJob" ADD CONSTRAINT "ImageUpscaleJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
