CREATE TABLE "ListingAiWorkspace" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "draft" JSONB NOT NULL,
  "records" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ListingAiWorkspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingAiWorkspace_userId_key" ON "ListingAiWorkspace"("userId");
CREATE INDEX "ListingAiWorkspace_organizationId_updatedAt_idx" ON "ListingAiWorkspace"("organizationId", "updatedAt");

ALTER TABLE "ListingAiWorkspace"
  ADD CONSTRAINT "ListingAiWorkspace_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
