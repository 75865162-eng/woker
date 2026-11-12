-- Additive WMS overseas transfer evidence and explicit standard-cost valuation.
ALTER TABLE "WmsLot" ADD COLUMN "unitVolumeCubicMeters" DECIMAL(24,9);
ALTER TABLE "WmsMovement" ADD COLUMN "deltaVolumeCubicMeters" DECIMAL(30,9);
ALTER TABLE "WmsLocation" ADD COLUMN "parentId" TEXT;
ALTER TABLE "WmsLocation" ADD CONSTRAINT "WmsLocation_parent_scope_fk" FOREIGN KEY("organizationId","workspaceId","warehouseId","parentId") REFERENCES "WmsLocation"("organizationId","workspaceId","warehouseId",id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "WmsTransferOrderLine" ADD CONSTRAINT "WmsTransferOrderLine_scope_id" UNIQUE("organizationId","workspaceId",id);
ALTER TABLE "WmsMovement" ADD CONSTRAINT "WmsMovement_scope_id" UNIQUE("organizationId","workspaceId",id);
CREATE TABLE "WmsOverseasManifest" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"orderId" TEXT NOT NULL,
 "countryCode" TEXT NOT NULL CHECK("countryCode" ~ '^[A-Z]{2}$'),"destinationAddress" JSONB NOT NULL,reference TEXT NOT NULL,"requestHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("organizationId","workspaceId",id),UNIQUE("organizationId","workspaceId","orderId"),
 FOREIGN KEY("organizationId","workspaceId","orderId") REFERENCES "WmsTransferOrder"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "WmsOverseasLine" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"manifestId" TEXT NOT NULL,"transferLineId" TEXT NOT NULL,"sellerSku" TEXT,fnsku TEXT,
 UNIQUE("organizationId","workspaceId","manifestId","transferLineId"),
 FOREIGN KEY("organizationId","workspaceId","manifestId") REFERENCES "WmsOverseasManifest"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("organizationId","workspaceId","transferLineId") REFERENCES "WmsTransferOrderLine"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "WmsOverseasBox" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"manifestId" TEXT NOT NULL,number TEXT NOT NULL,
 "lengthCm" DECIMAL(18,6) NOT NULL,"widthCm" DECIMAL(18,6) NOT NULL,"heightCm" DECIMAL(18,6) NOT NULL,"grossWeightKg" DECIMAL(18,6) NOT NULL,"netWeightKg" DECIMAL(18,6),
 UNIQUE("organizationId","workspaceId",id),UNIQUE("organizationId","workspaceId","manifestId",number),
 FOREIGN KEY("organizationId","workspaceId","manifestId") REFERENCES "WmsOverseasManifest"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "WmsOverseasBoxItem" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"boxId" TEXT NOT NULL,"transferLineId" TEXT NOT NULL,quantity INTEGER NOT NULL,
 UNIQUE("organizationId","workspaceId","boxId","transferLineId"),
 FOREIGN KEY("organizationId","workspaceId","boxId") REFERENCES "WmsOverseasBox"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("organizationId","workspaceId","transferLineId") REFERENCES "WmsTransferOrderLine"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "WmsOverseasTransport" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"manifestId" TEXT NOT NULL,
 carrier TEXT NOT NULL,channel TEXT NOT NULL,"containerNumber" TEXT,"billOfLading" TEXT,"trackingNumber" TEXT NOT NULL,
 "departureAt" TIMESTAMP(3),"expectedArrivalAt" TIMESTAMP(3),"chargeableWeightKg" DECIMAL(18,6),"unitPrice" DECIMAL(24,6),surcharge DECIMAL(24,6),currency TEXT,"estimatedFee" DECIMAL(24,6),revision INTEGER NOT NULL DEFAULT 1,reference TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("organizationId","workspaceId","manifestId"),
 FOREIGN KEY("organizationId","workspaceId","manifestId") REFERENCES "WmsOverseasManifest"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "WmsCostRule" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"lotId" TEXT NOT NULL,"unitCost" DECIMAL(24,6) NOT NULL,currency TEXT NOT NULL,"inventoryAccount" TEXT NOT NULL,"offsetAccounts" JSONB NOT NULL,reference TEXT NOT NULL,"createdBy" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'DRAFT',revision INTEGER NOT NULL DEFAULT 1,"activatedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("organizationId","workspaceId",id),
 FOREIGN KEY("organizationId","workspaceId","lotId") REFERENCES "WmsLot"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "WmsCostRule_lot_effective_idx" ON "WmsCostRule"("organizationId","workspaceId","lotId",status,"activatedAt");
CREATE TABLE "WmsFinanceDraft" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"commandId" TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'NEEDS_DATA',revision INTEGER NOT NULL DEFAULT 1,voucher JSONB NOT NULL,"missingData" JSONB NOT NULL,"valuedBy" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,"valuedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("organizationId","workspaceId",id),UNIQUE("organizationId","workspaceId","commandId"),
 FOREIGN KEY("organizationId","workspaceId","commandId") REFERENCES "WmsCommand"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "WmsFinanceDraft_scope_date_idx" ON "WmsFinanceDraft"("organizationId","workspaceId","createdAt",id);
CREATE TABLE "WmsCostEntry" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"draftId" TEXT NOT NULL,"movementId" TEXT NOT NULL,"ruleId" TEXT NOT NULL,quantity INTEGER NOT NULL,"unitCost" DECIMAL(24,6) NOT NULL,amount DECIMAL(30,6) NOT NULL,currency TEXT NOT NULL,"debitAccount" TEXT NOT NULL,"creditAccount" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("organizationId","workspaceId","movementId"),
 FOREIGN KEY("organizationId","workspaceId","draftId") REFERENCES "WmsFinanceDraft"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("organizationId","workspaceId","movementId") REFERENCES "WmsMovement"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("organizationId","workspaceId","ruleId") REFERENCES "WmsCostRule"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- Evidence is append-only; new volume data never rewrites historical movements.
ALTER TABLE "WmsLot" ADD CONSTRAINT "WmsLot_volume_positive" CHECK ("unitVolumeCubicMeters" IS NULL OR "unitVolumeCubicMeters">0);
ALTER TABLE "WmsLocation" ADD CONSTRAINT "WmsLocation_not_self_parent" CHECK ("parentId" IS NULL OR "parentId"<>id);
ALTER TABLE "WmsOverseasBox" ADD CONSTRAINT "WmsOverseasBox_dimensions" CHECK ("lengthCm">0 AND "widthCm">0 AND "heightCm">0 AND "grossWeightKg">0 AND ("netWeightKg" IS NULL OR ("netWeightKg">=0 AND "netWeightKg"<="grossWeightKg")));
ALTER TABLE "WmsOverseasBoxItem" ADD CONSTRAINT "WmsOverseasBoxItem_quantity" CHECK (quantity>0);
ALTER TABLE "WmsOverseasTransport" ADD CONSTRAINT "WmsOverseasTransport_values" CHECK (revision>0 AND ("unitPrice" IS NULL OR "unitPrice">=0) AND (surcharge IS NULL OR surcharge>=0) AND ("chargeableWeightKg" IS NULL OR "chargeableWeightKg">0) AND ((currency IS NULL AND "estimatedFee" IS NULL) OR (currency IS NOT NULL AND currency ~ '^[A-Z]{3}$' AND "estimatedFee" IS NOT NULL AND "estimatedFee">=0)) AND ("departureAt" IS NULL OR "expectedArrivalAt" IS NULL OR "expectedArrivalAt">="departureAt"));
ALTER TABLE "WmsCostRule" ADD CONSTRAINT "WmsCostRule_values" CHECK ("unitCost">=0 AND currency ~ '^[A-Z]{3}$' AND length(trim("inventoryAccount"))>0 AND jsonb_typeof("offsetAccounts")='object' AND ((status='DRAFT' AND revision=1 AND "activatedAt" IS NULL) OR (status='ACTIVE' AND revision=2 AND "activatedAt" IS NOT NULL)));
ALTER TABLE "WmsFinanceDraft" ADD CONSTRAINT "WmsFinanceDraft_status" CHECK (revision>0 AND status IN ('NEEDS_DATA','DRAFT') AND (status<>'DRAFT' OR ("valuedAt" IS NOT NULL AND voucher->>'postingExecuted'='false')));
ALTER TABLE "WmsCostEntry" ADD CONSTRAINT "WmsCostEntry_values" CHECK (quantity<>0 AND "unitCost">=0 AND amount=abs(quantity::numeric)*"unitCost" AND currency ~ '^[A-Z]{3}$' AND "debitAccount"<>"creditAccount");
CREATE FUNCTION wms_port_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'WMS port evidence is immutable'; END $$;
CREATE TRIGGER wms_cost_entry_immutable BEFORE UPDATE OR DELETE ON "WmsCostEntry" FOR EACH ROW EXECUTE FUNCTION wms_port_evidence_immutable();
CREATE TRIGGER wms_overseas_manifest_immutable BEFORE UPDATE OR DELETE ON "WmsOverseasManifest" FOR EACH ROW EXECUTE FUNCTION wms_port_evidence_immutable();
CREATE TRIGGER wms_overseas_line_immutable BEFORE UPDATE OR DELETE ON "WmsOverseasLine" FOR EACH ROW EXECUTE FUNCTION wms_port_evidence_immutable();
CREATE TRIGGER wms_overseas_box_immutable BEFORE UPDATE OR DELETE ON "WmsOverseasBox" FOR EACH ROW EXECUTE FUNCTION wms_port_evidence_immutable();
CREATE TRIGGER wms_overseas_box_item_immutable BEFORE UPDATE OR DELETE ON "WmsOverseasBoxItem" FOR EACH ROW EXECUTE FUNCTION wms_port_evidence_immutable();
CREATE FUNCTION wms_cost_rule_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cost rules cannot be deleted'; END IF;
 IF OLD.status<>'DRAFT' OR NEW.status<>'ACTIVE' OR (to_jsonb(NEW)-ARRAY['status','revision','activatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','activatedAt']) THEN RAISE EXCEPTION 'Cost rule evidence cannot change'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER wms_cost_rule_guard BEFORE UPDATE OR DELETE ON "WmsCostRule" FOR EACH ROW EXECUTE FUNCTION wms_cost_rule_guard();
CREATE FUNCTION wms_finance_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'NEEDS_DATA' OR NEW.status<>'DRAFT' OR NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW."commandId"<>OLD."commandId" OR NEW."organizationId"<>OLD."organizationId" OR NEW."workspaceId"<>OLD."workspaceId" OR NEW."createdAt"<>OLD."createdAt" THEN RAISE EXCEPTION 'Finance draft evidence cannot change'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER wms_finance_draft_guard BEFORE UPDATE OR DELETE ON "WmsFinanceDraft" FOR EACH ROW EXECUTE FUNCTION wms_finance_draft_guard();
CREATE FUNCTION wms_overseas_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM "WmsOverseasManifest" m JOIN "WmsTransferOrderLine" l ON l."orderId"=m."orderId" AND l."organizationId"=m."organizationId" AND l."workspaceId"=m."workspaceId" WHERE m.id=NEW."manifestId" AND m."organizationId"=NEW."organizationId" AND m."workspaceId"=NEW."workspaceId" AND l.id=NEW."transferLineId") THEN RAISE EXCEPTION 'Foreign overseas line'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER wms_overseas_line_guard BEFORE INSERT ON "WmsOverseasLine" FOR EACH ROW EXECUTE FUNCTION wms_overseas_line_guard();
CREATE FUNCTION wms_overseas_box_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM "WmsOverseasBox" b JOIN "WmsOverseasLine" l ON l."manifestId"=b."manifestId" AND l."organizationId"=b."organizationId" AND l."workspaceId"=b."workspaceId" WHERE b.id=NEW."boxId" AND b."organizationId"=NEW."organizationId" AND b."workspaceId"=NEW."workspaceId" AND l."transferLineId"=NEW."transferLineId") THEN RAISE EXCEPTION 'Foreign overseas box item'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER wms_overseas_box_item_guard BEFORE INSERT ON "WmsOverseasBoxItem" FOR EACH ROW EXECUTE FUNCTION wms_overseas_box_item_guard();
CREATE INDEX "WmsCostRule_scope_page_idx" ON "WmsCostRule"("organizationId","workspaceId","createdAt",id);
CREATE INDEX "WmsCostEntry_scope_page_idx" ON "WmsCostEntry"("organizationId","workspaceId","createdAt",id);
CREATE INDEX "WmsOverseasManifest_scope_page_idx" ON "WmsOverseasManifest"("organizationId","workspaceId","createdAt",id);

CREATE FUNCTION wms_lot_volume_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."unitVolumeCubicMeters" IS DISTINCT FROM OLD."unitVolumeCubicMeters" AND EXISTS(SELECT 1 FROM "WmsMovement" m JOIN "WmsStockBalance" b ON b.id=m."balanceId" AND b."organizationId"=m."organizationId" AND b."workspaceId"=m."workspaceId" WHERE b."lotId"=OLD.id AND b."organizationId"=OLD."organizationId" AND b."workspaceId"=OLD."workspaceId") THEN RAISE EXCEPTION 'Historical lot volume cannot change'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER wms_lot_volume_guard BEFORE UPDATE ON "WmsLot" FOR EACH ROW EXECUTE FUNCTION wms_lot_volume_guard();
