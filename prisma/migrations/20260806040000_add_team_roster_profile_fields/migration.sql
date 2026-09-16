ALTER TABLE "TeamRosterMember"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "amazonStorePermissions" TEXT,
  ADD COLUMN "multiPlatformStorePermissions" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "lastLoginIp" TEXT,
  ADD COLUMN "lastLoginAt" TEXT,
  ADD COLUMN "sourceCreatedAt" TEXT;
