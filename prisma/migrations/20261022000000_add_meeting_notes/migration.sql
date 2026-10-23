CREATE TABLE "ProductMeetingNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "productRecordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMeetingNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductMeetingNote_organizationId_workspaceId_productRecordId_createdAt_idx" ON "ProductMeetingNote"("organizationId", "workspaceId", "productRecordId", "createdAt");

ALTER TABLE "ProductMeetingNote" ADD CONSTRAINT "ProductMeetingNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMeetingNote" ADD CONSTRAINT "ProductMeetingNote_productRecordId_fkey" FOREIGN KEY ("productRecordId") REFERENCES "ProductRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMeetingNote" ADD CONSTRAINT "ProductMeetingNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
