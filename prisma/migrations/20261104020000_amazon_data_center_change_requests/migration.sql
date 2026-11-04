CREATE TABLE "AmazonDataCenterChangeRequest" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
  "targetEnvironment" TEXT NOT NULL, "changeType" TEXT NOT NULL, "operation" TEXT NOT NULL, "targetId" TEXT NOT NULL,
  "beforeSummary" JSONB NOT NULL, "afterSummary" JSONB NOT NULL,
  "sellerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "marketplaceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "sourceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "baseRevision" INTEGER NOT NULL, "changeDigest" TEXT NOT NULL, "payloadDigest" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL, "approvedByUserId" TEXT, "decidedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'REQUESTED', "expiresAt" TIMESTAMP(3) NOT NULL, "appliedAt" TIMESTAMP(3),
  "decisionReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonDataCenterChangeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonDataCenterChangeRequest_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonDataCenterChangeRequest_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonDataCenterChangeRequest_requestedBy_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonDataCenterChangeRequest_approvedBy_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonDataCenterChangeRequest_requester_membership_fkey" FOREIGN KEY ("organizationId", "requestedByUserId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonDataCenterChangeRequest_approver_membership_fkey" FOREIGN KEY ("organizationId", "approvedByUserId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonDataCenterChange_scope_id_key" ON "AmazonDataCenterChangeRequest"("organizationId", "workspaceId", "id");
CREATE INDEX "AmazonDataCenterChange_scope_status_created_idx" ON "AmazonDataCenterChangeRequest"("organizationId", "workspaceId", "status", "createdAt");
CREATE TABLE "AmazonDataCenterSealedCommand" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "ciphertext" TEXT NOT NULL,
  CONSTRAINT "AmazonDataCenterSealedCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonDataCenterSealedCommand_request_fkey" FOREIGN KEY ("organizationId", "workspaceId", "id") REFERENCES "AmazonDataCenterChangeRequest"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonDataCenterSealedCommand_scope_id_key" ON "AmazonDataCenterSealedCommand"("organizationId", "workspaceId", "id");
CREATE TABLE "AmazonDataCenterConfigVersion" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "targetEnvironment" TEXT NOT NULL,
  "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "summary" JSONB NOT NULL,
  "approvalId" TEXT NOT NULL, "changeDigest" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AmazonDataCenterConfigVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonDataCenterConfigVersion_approval_fkey" FOREIGN KEY ("organizationId", "workspaceId", "approvalId") REFERENCES "AmazonDataCenterChangeRequest"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonDataCenterConfigVersion_entity_revision_key" ON "AmazonDataCenterConfigVersion"("organizationId", "workspaceId", "entityType", "entityId", "revision");
CREATE INDEX "AmazonDataCenterConfigVersion_entity_created_idx" ON "AmazonDataCenterConfigVersion"("organizationId", "workspaceId", "entityId", "createdAt");
ALTER TABLE "AmazonSyncRun" ADD COLUMN "executionApprovalId" TEXT;
ALTER TABLE "AmazonSyncRun" ADD COLUMN "frozenScope" JSONB;
ALTER TABLE "AmazonSyncRun" ADD COLUMN "frozenScopeDigest" TEXT;
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_executionApproval_fkey" FOREIGN KEY ("organizationId", "workspaceId", "executionApprovalId") REFERENCES "AmazonDataCenterChangeRequest"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AmazonSyncDataSource" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "AmazonDataCenterChangeRequest"
  ADD CONSTRAINT "AmazonDataCenterChangeRequest_environment_check" CHECK ("targetEnvironment" IN ('local', 'staging', 'production')),
  ADD CONSTRAINT "AmazonDataCenterChangeRequest_type_check" CHECK ("changeType" IN ('CredentialChange', 'ScopeBindingChange', 'SyncPolicyChange', 'SyncExecutionRequest')),
  ADD CONSTRAINT "AmazonDataCenterChangeRequest_status_check" CHECK ("status" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED', 'APPLYING', 'APPLIED', 'STALE', 'EXPIRED', 'FAILED')),
  ADD CONSTRAINT "AmazonDataCenterChangeRequest_operation_check" CHECK ("operation" IN ('save-authorization', 'disable-authorization', 'save-source', 'save-plan', 'run', 'control-task', 'validate-authorization')),
  ADD CONSTRAINT "AmazonDataCenterChangeRequest_revision_check" CHECK ("baseRevision" >= 0);

CREATE FUNCTION "guard_amazon_data_center_request_payload"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."organizationId" IS DISTINCT FROM NEW."organizationId"
    OR OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId"
    OR OLD."targetEnvironment" IS DISTINCT FROM NEW."targetEnvironment"
    OR OLD."changeType" IS DISTINCT FROM NEW."changeType"
    OR OLD."operation" IS DISTINCT FROM NEW."operation"
    OR OLD."targetId" IS DISTINCT FROM NEW."targetId"
    OR OLD."beforeSummary" IS DISTINCT FROM NEW."beforeSummary"
    OR OLD."afterSummary" IS DISTINCT FROM NEW."afterSummary"
    OR OLD."sellerIds" IS DISTINCT FROM NEW."sellerIds"
    OR OLD."marketplaceIds" IS DISTINCT FROM NEW."marketplaceIds"
    OR OLD."domains" IS DISTINCT FROM NEW."domains"
    OR OLD."sourceIds" IS DISTINCT FROM NEW."sourceIds"
    OR OLD."baseRevision" IS DISTINCT FROM NEW."baseRevision"
    OR OLD."changeDigest" IS DISTINCT FROM NEW."changeDigest"
    OR OLD."payloadDigest" IS DISTINCT FROM NEW."payloadDigest"
    OR OLD."requestedByUserId" IS DISTINCT FROM NEW."requestedByUserId"
    OR OLD."expiresAt" IS DISTINCT FROM NEW."expiresAt"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'Amazon data center approval payload is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AmazonDataCenterChangeRequest_payload_immutable"
  BEFORE UPDATE ON "AmazonDataCenterChangeRequest"
  FOR EACH ROW EXECUTE FUNCTION "guard_amazon_data_center_request_payload"();

CREATE FUNCTION "guard_amazon_data_center_request_transition"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = NEW."status" THEN RETURN NEW; END IF;
  IF (OLD."status" = 'REQUESTED' AND NEW."status" IN ('APPROVED', 'REJECTED', 'REVOKED', 'STALE', 'EXPIRED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('APPLYING', 'REVOKED', 'STALE', 'EXPIRED'))
    OR (OLD."status" = 'APPLYING' AND NEW."status" IN ('APPLIED', 'FAILED'))
    OR (OLD."status" = 'APPLIED' AND NEW."status" = 'REVOKED' AND OLD."changeType" = 'SyncExecutionRequest') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invalid Amazon data center approval state transition';
END;
$$;
CREATE TRIGGER "AmazonDataCenterChangeRequest_status_transition"
  BEFORE UPDATE OF "status" ON "AmazonDataCenterChangeRequest"
  FOR EACH ROW EXECUTE FUNCTION "guard_amazon_data_center_request_transition"();

CREATE FUNCTION "reject_amazon_data_center_version_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Amazon data center configuration versions are immutable';
END;
$$;
CREATE TRIGGER "AmazonDataCenterConfigVersion_immutable"
  BEFORE UPDATE OR DELETE ON "AmazonDataCenterConfigVersion"
  FOR EACH ROW EXECUTE FUNCTION "reject_amazon_data_center_version_mutation"();

CREATE TRIGGER "AmazonDataCenterSealedCommand_no_update"
  BEFORE UPDATE ON "AmazonDataCenterSealedCommand"
  FOR EACH ROW EXECUTE FUNCTION "reject_amazon_data_center_version_mutation"();
