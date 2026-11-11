-- Preserve all existing records. Duplicate names require explicit review before migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ListingAiGallerySave"
    GROUP BY "organizationId", "workspaceId", "userId", "name"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Listing AI gallery names exist; review and rename records before applying this migration.';
  END IF;
END $$;
CREATE UNIQUE INDEX "ListingAiGallerySave_scope_name_key"
ON "ListingAiGallerySave"("organizationId", "workspaceId", "userId", "name");
