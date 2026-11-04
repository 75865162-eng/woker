-- Write-only delivery; separate approval required before execution.
CREATE TABLE "AmazonDataAccessGrant" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "userId" TEXT NOT NULL, "sellerAccountId" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AmazonAccess_member_fkey" FOREIGN KEY ("organizationId","userId") REFERENCES "OrganizationMember"("organizationId","userId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AmazonAccess_workspace_fkey" FOREIGN KEY ("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AmazonAccess_seller_fkey" FOREIGN KEY ("organizationId","workspaceId","sellerAccountId") REFERENCES "SellerAccount"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonAccess_member_seller_key" ON "AmazonDataAccessGrant"("organizationId","workspaceId","userId","sellerAccountId");
CREATE INDEX "AmazonAccess_lookup_idx" ON "AmazonDataAccessGrant"("organizationId","workspaceId","userId","enabled");
ALTER TABLE "AmazonDataCenterChangeRequest" DROP CONSTRAINT "AmazonDataCenterChangeRequest_operation_check";
ALTER TABLE "AmazonDataCenterChangeRequest" ADD CONSTRAINT "AmazonDataCenterChangeRequest_operation_check" CHECK ("operation" IN ('save-authorization','disable-authorization','save-source','save-plan','run','control-task','validate-authorization','save-access-grant'));
-- No grant backfill: ordinary members require explicit approved grants.
-- Old unbounded tasks fail closed in code until a new control-task approval renews the window.
