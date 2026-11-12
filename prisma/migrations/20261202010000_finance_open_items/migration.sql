-- Extend the existing open-item guards to version partial allocations and preserve reversal evidence.

ALTER TABLE "FinanceOpenItem" ADD CONSTRAINT "FinanceOpenItem_value_check" CHECK (amount > 0 AND revision > 0 AND currency ~ '^[A-Z]{3}$' AND kind IN ('PAYABLE','RECEIVABLE','PAYMENT','RECEIPT') AND status IN ('OPEN','VOIDED') AND length(trim(counterparty)) > 0);
ALTER TABLE "FinanceSettlement" ADD CONSTRAINT "FinanceSettlement_value_check" CHECK (amount > 0 AND "documentId" <> "paymentId" AND (("reversedAt" IS NULL AND "reversedBy" IS NULL AND "reversalEvidence" IS NULL) OR ("reversedAt" IS NOT NULL AND "reversedBy" IS NOT NULL AND length(trim("reversalEvidence")) > 0)));
CREATE OR REPLACE FUNCTION finance_open_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Open item evidence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW) - ARRAY['revision','status']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revision','status']) OR OLD.status='VOIDED' OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Open item evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION finance_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Settlement evidence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD."reversedAt" IS NOT NULL OR NEW."reversedAt" IS NULL OR (to_jsonb(NEW) - ARRAY['reversedAt','reversedBy','reversalEvidence']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['reversedAt','reversedBy','reversalEvidence']) THEN
    RAISE EXCEPTION 'Settlement evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
