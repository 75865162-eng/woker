-- AI 对话持久化：会话 / 消息 / 运行 / 工具证据。
-- 前向安全：全部使用 IF NOT EXISTS，重复执行不报错、不改动既有数据。
-- 所有表带 organizationId/workspaceId/userId 三元组，索引限定访问范围。

CREATE TABLE IF NOT EXISTS "AiChatConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新对话',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiChatConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiChatMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "clientKey" TEXT,
    "skillSlug" TEXT,
    "skillHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiChatRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "model" TEXT,
    "skillSlug" TEXT,
    "skillHash" TEXT,
    "answerPreview" TEXT,
    "errorCode" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiChatRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiChatToolCall" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "argsSummary" TEXT NOT NULL,
    "resultSource" TEXT,
    "resultHash" TEXT,
    "rowCount" INTEGER,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiChatToolCall_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiChatMessage_conversationId_clientKey_key" ON "AiChatMessage"("conversationId", "clientKey");
CREATE UNIQUE INDEX IF NOT EXISTS "AiChatRun_requestKey_key" ON "AiChatRun"("requestKey");
CREATE INDEX IF NOT EXISTS "AiChatConversation_org_ws_user_updated_idx" ON "AiChatConversation"("organizationId", "workspaceId", "userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "AiChatConversation_org_ws_status_idx" ON "AiChatConversation"("organizationId", "workspaceId", "status");
CREATE INDEX IF NOT EXISTS "AiChatMessage_org_ws_user_created_idx" ON "AiChatMessage"("organizationId", "workspaceId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiChatMessage_conversation_created_idx" ON "AiChatMessage"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiChatRun_conversation_created_idx" ON "AiChatRun"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiChatRun_org_ws_user_created_idx" ON "AiChatRun"("organizationId", "workspaceId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiChatToolCall_run_seq_idx" ON "AiChatToolCall"("runId", "seq");
CREATE INDEX IF NOT EXISTS "AiChatToolCall_org_ws_user_created_idx" ON "AiChatToolCall"("organizationId", "workspaceId", "userId", "createdAt");

-- 外键：conversation 级联消息，消息级联 run，run 级联工具证据。
-- 用 DO 块保证前向安全（重复执行跳过）。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiChatMessage_conversation_fkey') THEN
    ALTER TABLE "AiChatMessage" ADD CONSTRAINT "AiChatMessage_conversation_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "AiChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiChatRun_message_fkey') THEN
    ALTER TABLE "AiChatRun" ADD CONSTRAINT "AiChatRun_message_fkey"
      FOREIGN KEY ("messageId") REFERENCES "AiChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiChatToolCall_run_fkey') THEN
    ALTER TABLE "AiChatToolCall" ADD CONSTRAINT "AiChatToolCall_run_fkey"
      FOREIGN KEY ("runId") REFERENCES "AiChatRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
