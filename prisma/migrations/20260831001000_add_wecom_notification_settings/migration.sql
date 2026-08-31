CREATE TABLE IF NOT EXISTS "WeComNotificationSetting" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "accountId" TEXT NOT NULL DEFAULT '',
    "marketplace" TEXT NOT NULL DEFAULT '',
    "settings" JSONB NOT NULL,
    "sentRecords" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeComNotificationSetting_pkey" PRIMARY KEY ("organizationId", "workspaceId", "userId")
);

CREATE INDEX IF NOT EXISTS "WeComNotificationSetting_organizationId_workspaceId_updatedAt_idx" ON "WeComNotificationSetting"("organizationId", "workspaceId", "updatedAt");
CREATE INDEX IF NOT EXISTS "WeComNotificationSetting_userId_updatedAt_idx" ON "WeComNotificationSetting"("userId", "updatedAt");

DO $$ BEGIN
    ALTER TABLE "WeComNotificationSetting"
        ADD CONSTRAINT "WeComNotificationSetting_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "WeComNotificationSetting"
        ADD CONSTRAINT "WeComNotificationSetting_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
