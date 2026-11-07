-- Separate Amazon Ads OAuth identity and profiles from SP-API credentials.
CREATE TABLE "AmazonAdsAuthorization" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "name" TEXT NOT NULL,
  "credentialsCiphertext" TEXT NOT NULL,
  "consentRegion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "authorizedByUserId" TEXT NOT NULL,
  "refreshTokenExpiresAt" TIMESTAMP(3),
  "lastValidatedAt" TIMESTAMP(3),
  "validationErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsAuthorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsAuth_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsAuth_actor_fkey" FOREIGN KEY ("organizationId", "authorizedByUserId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonAdsAuth_scope_id_key" ON "AmazonAdsAuthorization"("organizationId", "workspaceId", "id");
CREATE INDEX "AmazonAdsAuth_scope_status_idx" ON "AmazonAdsAuthorization"("organizationId", "workspaceId", "status", "updatedAt");

CREATE TABLE "AmazonAdsProfile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "authorizationId" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "marketplaceId" TEXT,
  "currencyCode" TEXT,
  "timezone" TEXT,
  "accountInfo" JSONB NOT NULL,
  "sellerAccountId" TEXT,
  "lastDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsProfile_auth_fkey" FOREIGN KEY ("organizationId", "workspaceId", "authorizationId") REFERENCES "AmazonAdsAuthorization"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonAdsProfile_auth_profile_key" ON "AmazonAdsProfile"("organizationId", "workspaceId", "authorizationId", "region", "profileId");
CREATE INDEX "AmazonAdsProfile_scope_country_idx" ON "AmazonAdsProfile"("organizationId", "workspaceId", "countryCode");
CREATE INDEX "AmazonAdsProfile_scope_seller_idx" ON "AmazonAdsProfile"("organizationId", "workspaceId", "sellerAccountId");

CREATE TABLE "AmazonAdsOAuthAttempt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "userId" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsOAuthAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonAdsOAuth_actor_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonAdsOAuth_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AmazonAdsOAuthAttempt_stateHash_key" ON "AmazonAdsOAuthAttempt"("stateHash");
CREATE INDEX "AmazonAdsOAuth_scope_user_status_idx" ON "AmazonAdsOAuthAttempt"("organizationId", "workspaceId", "userId", "status");
CREATE INDEX "AmazonAdsOAuth_status_expiry_idx" ON "AmazonAdsOAuthAttempt"("status", "expiresAt");
