ALTER TABLE "TeamRosterMember" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "TeamRosterMember" ADD COLUMN IF NOT EXISTS "amazonStorePermissions" TEXT;
ALTER TABLE "TeamRosterMember" ADD COLUMN IF NOT EXISTS "multiPlatformStorePermissions" TEXT;
ALTER TABLE "TeamRosterMember" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "TeamRosterMember" ADD COLUMN IF NOT EXISTS "lastLoginIp" TEXT;
ALTER TABLE "TeamRosterMember" ADD COLUMN IF NOT EXISTS "lastLoginAt" TEXT;
ALTER TABLE "TeamRosterMember" ADD COLUMN IF NOT EXISTS "sourceCreatedAt" TEXT;
