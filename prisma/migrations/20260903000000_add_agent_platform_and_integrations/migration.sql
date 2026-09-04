CREATE TABLE IF NOT EXISTS "AgentDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "systemInstructions" TEXT NOT NULL,
    "goals" JSONB NOT NULL,
    "skills" JSONB NOT NULL,
    "tools" JSONB NOT NULL,
    "permissions" JSONB NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "approvalPolicy" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentTool" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "permission" JSONB NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "retryPolicy" JSONB NOT NULL,
    "adapterType" TEXT NOT NULL,
    "config" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentDefinitionId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "accountId" TEXT NOT NULL DEFAULT '',
    "marketplace" TEXT NOT NULL DEFAULT '',
    "sku" TEXT,
    "asin" TEXT,
    "projectId" TEXT,
    "taskId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "input" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "recommendation" JSONB,
    "decision" JSONB,
    "output" JSONB,
    "approvalStatus" TEXT,
    "tokenUsage" INTEGER NOT NULL DEFAULT 0,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "error" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentExecutionTrace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "redactedPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentExecutionTrace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentToolCall" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "permission" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "redactedInput" JSONB NOT NULL,
    "output" JSONB,
    "redactedOutput" JSONB,
    "latencyMs" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "toolCallId" TEXT,
    "riskLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "recommendation" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "humanDecision" JSONB,
    "requestedByUserId" TEXT,
    "decidedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentMemory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentDefinitionId" TEXT,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "sourceExecutionId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentEvaluationCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentDefinitionId" TEXT,
    "name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "expectedBehavior" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvaluationCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentEvaluationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "evaluationCaseId" TEXT NOT NULL,
    "executionId" TEXT,
    "input" JSONB NOT NULL,
    "expectedBehavior" JSONB NOT NULL,
    "actualBehavior" JSONB NOT NULL,
    "toolCalls" JSONB NOT NULL,
    "finalOutput" JSONB NOT NULL,
    "score" DOUBLE PRECISION,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvaluationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExternalIntegrationSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "accountId" TEXT NOT NULL DEFAULT '',
    "marketplace" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalIntegrationSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentTool_organizationId_toolId_key" ON "AgentTool"("organizationId", "toolId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIntegrationSetting_organizationId_workspaceId_userId_provider_key" ON "ExternalIntegrationSetting"("organizationId", "workspaceId", "userId", "provider");

CREATE INDEX IF NOT EXISTS "AgentDefinition_organizationId_enabled_updatedAt_idx" ON "AgentDefinition"("organizationId", "enabled", "updatedAt");
CREATE INDEX IF NOT EXISTS "AgentDefinition_organizationId_updatedAt_idx" ON "AgentDefinition"("organizationId", "updatedAt");
CREATE INDEX IF NOT EXISTS "AgentTool_organizationId_enabled_updatedAt_idx" ON "AgentTool"("organizationId", "enabled", "updatedAt");
CREATE INDEX IF NOT EXISTS "AgentExecution_organizationId_agentDefinitionId_createdAt_idx" ON "AgentExecution"("organizationId", "agentDefinitionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentExecution_organizationId_workspaceId_createdAt_idx" ON "AgentExecution"("organizationId", "workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentExecution_organizationId_accountId_marketplace_createdAt_idx" ON "AgentExecution"("organizationId", "accountId", "marketplace", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentExecution_organizationId_sku_createdAt_idx" ON "AgentExecution"("organizationId", "sku", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentExecution_organizationId_asin_createdAt_idx" ON "AgentExecution"("organizationId", "asin", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentExecution_organizationId_status_createdAt_idx" ON "AgentExecution"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentExecutionTrace_organizationId_executionId_sequence_idx" ON "AgentExecutionTrace"("organizationId", "executionId", "sequence");
CREATE INDEX IF NOT EXISTS "AgentExecutionTrace_organizationId_eventType_createdAt_idx" ON "AgentExecutionTrace"("organizationId", "eventType", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentToolCall_organizationId_executionId_createdAt_idx" ON "AgentToolCall"("organizationId", "executionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentToolCall_organizationId_toolId_createdAt_idx" ON "AgentToolCall"("organizationId", "toolId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentApproval_organizationId_executionId_requestedAt_idx" ON "AgentApproval"("organizationId", "executionId", "requestedAt");
CREATE INDEX IF NOT EXISTS "AgentApproval_organizationId_status_requestedAt_idx" ON "AgentApproval"("organizationId", "status", "requestedAt");
CREATE INDEX IF NOT EXISTS "AgentEvent_organizationId_executionId_createdAt_idx" ON "AgentEvent"("organizationId", "executionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentEvent_organizationId_eventType_createdAt_idx" ON "AgentEvent"("organizationId", "eventType", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentMemory_organizationId_scope_scopeKey_createdAt_idx" ON "AgentMemory"("organizationId", "scope", "scopeKey", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentMemory_organizationId_agentDefinitionId_createdAt_idx" ON "AgentMemory"("organizationId", "agentDefinitionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentTask_organizationId_status_createdAt_idx" ON "AgentTask"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentTask_organizationId_executionId_createdAt_idx" ON "AgentTask"("organizationId", "executionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentEvaluationCase_organizationId_agentDefinitionId_createdAt_idx" ON "AgentEvaluationCase"("organizationId", "agentDefinitionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentEvaluationRun_organizationId_evaluationCaseId_createdAt_idx" ON "AgentEvaluationRun"("organizationId", "evaluationCaseId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentEvaluationRun_organizationId_executionId_createdAt_idx" ON "AgentEvaluationRun"("organizationId", "executionId", "createdAt");
CREATE INDEX IF NOT EXISTS "ExternalIntegrationSetting_org_workspace_provider_updated" ON "ExternalIntegrationSetting"("organizationId", "workspaceId", "provider", "updatedAt");
CREATE INDEX IF NOT EXISTS "ExternalIntegrationSetting_userId_updatedAt_idx" ON "ExternalIntegrationSetting"("userId", "updatedAt");

DO $$ BEGIN
    ALTER TABLE "AgentExecution"
        ADD CONSTRAINT "AgentExecution_agentDefinitionId_fkey"
        FOREIGN KEY ("agentDefinitionId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "AgentExecutionTrace"
        ADD CONSTRAINT "AgentExecutionTrace_executionId_fkey"
        FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "AgentToolCall"
        ADD CONSTRAINT "AgentToolCall_executionId_fkey"
        FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "AgentApproval"
        ADD CONSTRAINT "AgentApproval_executionId_fkey"
        FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "AgentEvent"
        ADD CONSTRAINT "AgentEvent_executionId_fkey"
        FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "AgentMemory"
        ADD CONSTRAINT "AgentMemory_sourceExecutionId_fkey"
        FOREIGN KEY ("sourceExecutionId") REFERENCES "AgentExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "AgentTask"
        ADD CONSTRAINT "AgentTask_executionId_fkey"
        FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "AgentEvaluationCase"
        ADD CONSTRAINT "AgentEvaluationCase_agentDefinitionId_fkey"
        FOREIGN KEY ("agentDefinitionId") REFERENCES "AgentDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "AgentEvaluationRun"
        ADD CONSTRAINT "AgentEvaluationRun_evaluationCaseId_fkey"
        FOREIGN KEY ("evaluationCaseId") REFERENCES "AgentEvaluationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "AgentEvaluationRun"
        ADD CONSTRAINT "AgentEvaluationRun_executionId_fkey"
        FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "ExternalIntegrationSetting"
        ADD CONSTRAINT "ExternalIntegrationSetting_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "ExternalIntegrationSetting"
        ADD CONSTRAINT "ExternalIntegrationSetting_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
