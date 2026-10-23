CREATE TABLE "AmazonAgentActionAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "actorUserId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "idempotencyKey" TEXT,
    "preview" JSONB NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonAgentActionAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonAgentActionAudit_organizationId_workspaceId_idempotencyKey_key"
  ON "AmazonAgentActionAudit"("organizationId", "workspaceId", "idempotencyKey");
CREATE INDEX "AmazonAgentActionAudit_organizationId_workspaceId_createdAt_idx"
  ON "AmazonAgentActionAudit"("organizationId", "workspaceId", "createdAt");
CREATE INDEX "AmazonAgentActionAudit_organizationId_workspaceId_targetType_targetId_createdAt_idx"
  ON "AmazonAgentActionAudit"("organizationId", "workspaceId", "targetType", "targetId", "createdAt");
