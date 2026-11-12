-- Transactional WMS event infrastructure; does not add mapped Wimoor business tables.
CREATE TABLE "WmsDomainEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WmsDomainEvent_version_check" CHECK ("schemaVersion" > 0),
  CONSTRAINT "WmsDomainEvent_command_fkey" FOREIGN KEY ("organizationId", "workspaceId", "commandId") REFERENCES "WmsCommand"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "WmsDomainEvent_organizationId_workspaceId_commandId_key" ON "WmsDomainEvent"("organizationId", "workspaceId", "commandId");
CREATE UNIQUE INDEX "WmsDomainEvent_organizationId_workspaceId_id_key" ON "WmsDomainEvent"("organizationId", "workspaceId", "id");
CREATE INDEX "WmsDomainEvent_occurredAt_id_idx" ON "WmsDomainEvent"("occurredAt", "id");

CREATE TABLE "WmsEventDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "consumerId" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WmsEventDelivery_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "WmsEventDelivery_event_fkey" FOREIGN KEY ("organizationId", "workspaceId", "eventId") REFERENCES "WmsDomainEvent"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "WmsEventDelivery_eventId_consumerId_key" ON "WmsEventDelivery"("eventId", "consumerId");
CREATE INDEX "WmsEventDelivery_consumerId_processedAt_availableAt_id_idx" ON "WmsEventDelivery"("consumerId", "processedAt", "availableAt", "id");

CREATE FUNCTION wms_domain_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WMS domain events are append-only';
END;
$$;
CREATE TRIGGER "WmsDomainEvent_immutable" BEFORE UPDATE OR DELETE ON "WmsDomainEvent"
FOR EACH ROW EXECUTE FUNCTION wms_domain_event_immutable();
