CREATE TABLE "LiliOAuthClient" ("id" TEXT PRIMARY KEY, "redirectUris" TEXT[] NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "LiliOAuthGrant" ("id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL REFERENCES "LiliOAuthClient"("id"), "deviceId" TEXT NOT NULL UNIQUE REFERENCES "AmazonMcpCredential"("id"), "resource" TEXT NOT NULL, "redirectUri" TEXT NOT NULL, "challenge" TEXT NOT NULL, "codeHash" TEXT NOT NULL UNIQUE, "codeExpiresAt" TIMESTAMP(3) NOT NULL, "codeUsedAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "LiliOAuthGrant_clientId_idx" ON "LiliOAuthGrant"("clientId");
CREATE TABLE "LiliOAuthRefresh" ("hash" TEXT PRIMARY KEY, "grantId" TEXT NOT NULL REFERENCES "LiliOAuthGrant"("id"), "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "LiliOAuthRefresh_grantId_idx" ON "LiliOAuthRefresh"("grantId");
