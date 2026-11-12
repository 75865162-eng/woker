CREATE TABLE "ProductCatalogEntry" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "workspaceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('BRAND', 'CATEGORY')),
  "code" TEXT NOT NULL CHECK (length(trim("code")) BETWEEN 1 AND 50),
  "name" TEXT NOT NULL CHECK (length(trim("name")) BETWEEN 1 AND 100),
  "color" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("organizationId", "workspaceId", "id"),
  UNIQUE ("organizationId", "workspaceId", "kind", "code")
);
CREATE INDEX "ProductCatalogEntry_scope_kind_enabled_name" ON "ProductCatalogEntry" ("organizationId", "workspaceId", "kind", "enabled", "name");
