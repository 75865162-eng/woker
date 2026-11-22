-- AI 对话：当前账号显式确认启用的只读 MCP 数据源。
CREATE TABLE IF NOT EXISTS "AiChatDataSourceConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "userId" TEXT NOT NULL,
    "enabledProviders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiChatDataSourceConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiChatDataSourceConfig_organizationId_workspaceId_userId_key"
    ON "AiChatDataSourceConfig"("organizationId", "workspaceId", "userId");

CREATE INDEX IF NOT EXISTS "AiChatDataSourceConfig_organizationId_workspaceId_userId_idx"
    ON "AiChatDataSourceConfig"("organizationId", "workspaceId", "userId");
