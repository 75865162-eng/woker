-- MCP 提供方隔离：赛狐 MCP 独立凭证表
-- 只新增表与索引，不改动 AmazonMcpCredential 及任何既有表。
-- 与 AmazonMcpCredential 的隔离点：
--   * 物理分表，tokenHash 命名空间互不重叠（sfmcp_ / amcp_）
--   * storeIds 店铺围栏，Amazon 使用 sellerAccountId+marketplaceId
--   * 审计动作前缀 sellfox.mcp.*，Amazon 为 amazon.mcp.*

-- CreateTable
CREATE TABLE "SellfoxMcpCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tools" TEXT[],
    "storeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "rotatedFromId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellfoxMcpCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellfoxMcpCredential_tokenHash_key" ON "SellfoxMcpCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "SellfoxMcpCredential_organizationId_workspaceId_userId_status_idx" ON "SellfoxMcpCredential"("organizationId", "workspaceId", "userId", "status");

-- CreateIndex
CREATE INDEX "SellfoxMcpCredential_organizationId_workspaceId_expiresAt_idx" ON "SellfoxMcpCredential"("organizationId", "workspaceId", "expiresAt");

-- 防御性约束：令牌前缀必须属于赛狐命名空间，店铺数组元素不得为空串。
ALTER TABLE "SellfoxMcpCredential" ADD CONSTRAINT "SellfoxMcpCredential_token_prefix_check" CHECK ("tokenPrefix" LIKE 'sfmcp_%');
ALTER TABLE "SellfoxMcpCredential" ADD CONSTRAINT "SellfoxMcpCredential_status_check" CHECK ("status" IN ('ACTIVE', 'DISABLED', 'REVOKED'));
