-- Additive delivery. Apply only to a separately approved target. No identity/grant backfill.
ALTER TABLE "AmazonSpApiAuthorization" ADD COLUMN "identityVerifiedAt" TIMESTAMP(3), ADD COLUMN "identityEvidence" TEXT NOT NULL DEFAULT 'MANUAL_UNVERIFIED', ADD COLUMN "authorizedByUserId" TEXT;
ALTER TABLE "AmazonDataAccessGrant" ADD COLUMN "marketplaceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "actions" TEXT[] NOT NULL DEFAULT ARRAY['view','sync','export','edit']::TEXT[], ADD COLUMN "mcpEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "AmazonRoleDataAccessGrant" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "roleId" TEXT NOT NULL, "sellerAccountId" TEXT NOT NULL,
 "marketplaceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "actions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "mcpEnabled" BOOLEAN NOT NULL DEFAULT false,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("organizationId","roleId") REFERENCES "OrganizationRosterRole"("organizationId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("organizationId","workspaceId","sellerAccountId") REFERENCES "SellerAccount"("organizationId","workspaceId","id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "AmazonRoleGrant_scope_subject_seller_key" ON "AmazonRoleDataAccessGrant"("organizationId","workspaceId","roleId","sellerAccountId");
CREATE INDEX "AmazonRoleGrant_scope_subject_enabled_idx" ON "AmazonRoleDataAccessGrant"("organizationId","workspaceId","roleId","enabled");
CREATE TABLE "AmazonMcpCredential" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
 "tokenHash" TEXT NOT NULL, "tokenPrefix" TEXT NOT NULL, "tools" TEXT[] NOT NULL, "scopes" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','DISABLED','REVOKED')), "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdByUserId" TEXT NOT NULL, "rotatedFromId" TEXT REFERENCES "AmazonMcpCredential"("id") ON DELETE RESTRICT,
 "lastUsedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("organizationId","userId") REFERENCES "OrganizationMember"("organizationId","userId") ON DELETE RESTRICT,
 FOREIGN KEY ("organizationId","createdByUserId") REFERENCES "OrganizationMember"("organizationId","userId") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "AmazonMcpCredential_tokenHash_key" ON "AmazonMcpCredential"("tokenHash");
CREATE INDEX "AmazonMcpCredential_organizationId_workspaceId_userId_status_idx" ON "AmazonMcpCredential"("organizationId","workspaceId","userId","status");
CREATE TABLE "AmazonOAuthAttempt" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "userId" TEXT NOT NULL, "stateHash" TEXT NOT NULL,
 "region" TEXT NOT NULL, "redirectUri" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','EXCHANGING','COMPLETE','FAILED')),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("organizationId","userId") REFERENCES "OrganizationMember"("organizationId","userId") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "AmazonOAuthAttempt_stateHash_key" ON "AmazonOAuthAttempt"("stateHash");
CREATE TABLE "AmazonSellerIdentity" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "sellerAccountId" TEXT NOT NULL, "amazonSellerId" TEXT NOT NULL,
 "marketplaceId" TEXT NOT NULL, "region" TEXT NOT NULL, "authorizationId" TEXT NOT NULL, "verifiedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("organizationId","workspaceId","sellerAccountId") REFERENCES "SellerAccount"("organizationId","workspaceId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("organizationId","workspaceId","authorizationId") REFERENCES "AmazonSpApiAuthorization"("organizationId","workspaceId","id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "AmazonIdentity_scope_seller_site_key" ON "AmazonSellerIdentity"("organizationId","workspaceId","sellerAccountId","marketplaceId");
CREATE UNIQUE INDEX "AmazonIdentity_scope_amazon_site_region_key" ON "AmazonSellerIdentity"("organizationId","workspaceId","amazonSellerId","marketplaceId","region");
-- Rollback: disable MCP/OAuth entry points and run a compatible application. Preserve all
-- new tables, grants, hashes and identity evidence. No automatic DROP/down migration.
