-- Encrypted credentials only. This migration does not import environment values.
CREATE TABLE "SellfoxIntegrationCredential" (
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "credentialsCiphertext" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellfoxIntegrationCredential_pkey" PRIMARY KEY ("organizationId", "workspaceId"),
  CONSTRAINT "SellfoxIntegrationCredential_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "SellfoxIntegrationCredential_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
