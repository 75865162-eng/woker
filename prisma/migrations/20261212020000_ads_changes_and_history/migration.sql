CREATE TABLE "AmazonAdsChangeDraft" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "profileId" TEXT NOT NULL, "entityType" TEXT NOT NULL, "externalId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CANCELLED')),
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0), "requestKey" TEXT NOT NULL,
 "before" JSONB NOT NULL, "patch" JSONB NOT NULL, "snapshotHash" TEXT NOT NULL,
 "reason" TEXT NOT NULL, "createdBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "reviewedBy" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, "decisionReason" TEXT,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AdsChangeDraft_profile_fkey" FOREIGN KEY ("organizationId","workspaceId","profileId") REFERENCES "AmazonAdsProfile"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "AdsChangeDraft_request_key" UNIQUE ("organizationId","workspaceId","profileId","createdBy","requestKey"),
 CHECK ("reviewedBy" IS NULL OR "reviewedBy"<>"createdBy")
);
CREATE INDEX "AmazonAdsChangeDraft_scope_status" ON "AmazonAdsChangeDraft" ("organizationId","workspaceId","profileId","status","createdAt");
CREATE TABLE "AmazonAdsEntityHistory" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "profileId" TEXT NOT NULL, "entityType" TEXT NOT NULL, "externalId" TEXT NOT NULL,
 "sourceTaskId" TEXT NOT NULL, "before" JSONB, "after" JSONB NOT NULL,
 "observationHash" TEXT NOT NULL, "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AdsEntityHistory_task_fkey" FOREIGN KEY ("organizationId","workspaceId","sourceTaskId") REFERENCES "AmazonAdsSyncTask"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "AdsEntityHistory_profile_fkey" FOREIGN KEY ("organizationId","workspaceId","profileId") REFERENCES "AmazonAdsProfile"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "AdsEntityHistory_observation_key" UNIQUE ("organizationId","workspaceId","profileId","entityType","externalId","sourceTaskId","observationHash")
);
CREATE INDEX "AdsEntityHistory_entity_time_idx" ON "AmazonAdsEntityHistory" ("organizationId","workspaceId","profileId","entityType","externalId","observedAt");
CREATE FUNCTION ads_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Amazon Ads observations are immutable'; END;
$$;
CREATE TRIGGER ads_history_immutable BEFORE UPDATE OR DELETE ON "AmazonAdsEntityHistory" FOR EACH ROW EXECUTE FUNCTION ads_history_immutable();
CREATE FUNCTION ads_draft_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Ad change evidence cannot be deleted'; END IF;
 IF NEW."id"<>OLD."id" OR NEW."createdAt"<>OLD."createdAt" OR NEW."revision"<>OLD."revision"+1 OR NEW."organizationId"<>OLD."organizationId" OR NEW."workspaceId"<>OLD."workspaceId" OR NEW."profileId"<>OLD."profileId"
 OR NEW."createdBy"<>OLD."createdBy" OR NEW."externalId"<>OLD."externalId" OR NEW."entityType"<>OLD."entityType" OR NEW."requestKey"<>OLD."requestKey"
 OR NEW."before"<>OLD."before" OR NEW."patch"<>OLD."patch" OR NEW."snapshotHash"<>OLD."snapshotHash" OR NEW."reason"<>OLD."reason" OR NEW."expiresAt"<>OLD."expiresAt"
 OR NOT ((OLD.status='DRAFT' AND NEW.status IN ('SUBMITTED','CANCELLED')) OR (OLD.status='SUBMITTED' AND NEW.status IN ('APPROVED','REJECTED','CANCELLED')) OR (OLD.status='APPROVED' AND NEW.status='CANCELLED'))
 THEN RAISE EXCEPTION 'Invalid ad change transition'; END IF;
 IF NEW.status IN ('APPROVED','REJECTED') AND NEW."reviewedBy" IS NULL THEN RAISE EXCEPTION 'Independent reviewer required'; END IF;
 IF NEW.status NOT IN ('APPROVED','REJECTED') AND NEW."reviewedBy" IS DISTINCT FROM OLD."reviewedBy" THEN RAISE EXCEPTION 'Reviewer is immutable outside review'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ads_draft_transition_guard BEFORE UPDATE OR DELETE ON "AmazonAdsChangeDraft" FOR EACH ROW EXECUTE FUNCTION ads_draft_transition_guard();
