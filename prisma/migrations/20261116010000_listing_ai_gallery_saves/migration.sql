CREATE TABLE "ListingAiGallerySave" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "savedBy" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListingAiGallerySave_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ListingAiGallerySave_scope_created_idx"
ON "ListingAiGallerySave"("organizationId", "workspaceId", "userId", "createdAt", "id");
ALTER TABLE "ListingAiGallerySave" ADD CONSTRAINT "ListingAiGallerySave_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
