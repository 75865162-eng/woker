CREATE TYPE "TeamAccountStatus" AS ENUM ('active', 'pending', 'disabled');

CREATE TABLE "TeamRosterMember" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "status" "TeamAccountStatus" NOT NULL DEFAULT 'active',
  "lastActiveAt" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamRosterMember_pkey" PRIMARY KEY ("organizationId", "id")
);

CREATE INDEX "TeamRosterMember_organizationId_sortOrder_idx" ON "TeamRosterMember"("organizationId", "sortOrder");
CREATE INDEX "TeamRosterMember_organizationId_roleId_idx" ON "TeamRosterMember"("organizationId", "roleId");
CREATE INDEX "TeamRosterMember_organizationId_status_idx" ON "TeamRosterMember"("organizationId", "status");

ALTER TABLE "TeamRosterMember" ADD CONSTRAINT "TeamRosterMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
