CREATE TABLE "AiModelSetting" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "activeProfileId" TEXT,
  "settings" JSONB NOT NULL,
  "profiles" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiModelSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiModelSetting_userId_key" ON "AiModelSetting"("userId");
CREATE INDEX "AiModelSetting_organizationId_updatedAt_idx" ON "AiModelSetting"("organizationId", "updatedAt");

ALTER TABLE "AiModelSetting"
  ADD CONSTRAINT "AiModelSetting_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
