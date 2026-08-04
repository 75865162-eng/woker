CREATE TABLE "WorkspaceSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceSnapshot_userId_key" ON "WorkspaceSnapshot"("userId");
CREATE INDEX "WorkspaceSnapshot_organizationId_updatedAt_idx" ON "WorkspaceSnapshot"("organizationId", "updatedAt");

ALTER TABLE "WorkspaceSnapshot"
  ADD CONSTRAINT "WorkspaceSnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
