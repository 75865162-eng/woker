CREATE TABLE "ListingAiChatHistory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "accountId" TEXT NOT NULL DEFAULT '',
  "marketplace" TEXT NOT NULL DEFAULT '',
  "activeConversationId" TEXT NOT NULL DEFAULT '',
  "conversations" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ListingAiChatHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingAiChatHistory_organizationId_workspaceId_userId_key" ON "ListingAiChatHistory"("organizationId", "workspaceId", "userId");
CREATE INDEX "ListingAiChatHistory_organizationId_updatedAt_idx" ON "ListingAiChatHistory"("organizationId", "updatedAt");
CREATE INDEX "ListingAiChatHistory_organizationId_workspaceId_updatedAt_idx" ON "ListingAiChatHistory"("organizationId", "workspaceId", "updatedAt");
CREATE INDEX "ListingAiChatHistory_userId_updatedAt_idx" ON "ListingAiChatHistory"("userId", "updatedAt");

ALTER TABLE "ListingAiChatHistory"
  ADD CONSTRAINT "ListingAiChatHistory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
