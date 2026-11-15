-- Scope proposal identity to the Sellfox store and Amazon entity type.
-- Fail deployment rather than silently discard existing reviewed proposals.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SellfoxAdsProposal"
    GROUP BY "organizationId", "workspaceId", "storeId", "entityType", "externalId", "kind"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'SellfoxAdsProposal contains duplicate scoped identities; resolve them before migration';
  END IF;
END $$;

DROP INDEX IF EXISTS "SellfoxAdsProposal_key";
CREATE UNIQUE INDEX "SellfoxAdsProposal_key"
  ON "SellfoxAdsProposal"("organizationId", "workspaceId", "storeId", "entityType", "externalId", "kind");
