-- Synthetic legacy records, loaded only into a runner-created disposable database.
INSERT INTO "Organization" (id, name, slug, "updatedAt") VALUES ('org', 'Fixture', 'ads-migration-fixture', now());
INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt") VALUES ('actor', 'migration@fixture.invalid', 'Fixture', 'not-login', now());
INSERT INTO "OrganizationMember" (id, "organizationId", "userId", role, "updatedAt") VALUES ('member', 'org', 'actor', 'owner', now());
INSERT INTO "WorkspaceScope" ("organizationId", id, name, "updatedAt") VALUES ('org', 'default', 'Fixture', now());
INSERT INTO "SellerAccount" (id, "organizationId", "accountKey", "updatedAt") VALUES ('seller', 'org', 'fixture', now());
INSERT INTO "AmazonAdsAuthorization" (id, "organizationId", name, "credentialsCiphertext", "consentRegion", "authorizedByUserId", "updatedAt") VALUES ('auth', 'org', 'Fixture', 'fixture-not-a-secret', 'NA', 'actor', now());
INSERT INTO "AmazonAdsProfile" (id, "organizationId", "authorizationId", region, "profileId", "countryCode", "accountInfo", "updatedAt") VALUES
 ('profile-a', 'org', 'auth', 'NA', '111', 'US', '{}', now()),
 ('profile-b', 'org', 'auth', 'NA', '222', 'US', '{}', now());
INSERT INTO "AmazonAdsSyncPlan" (id, "organizationId", "profileId", "actorUserId", "sellerAccountId", "authorizationRevision", "updatedAt") VALUES ('plan', 'org', 'profile-a', 'actor', 'seller', 1, now());
INSERT INTO "AmazonAdsSyncTask" (id, "organizationId", "planId", "profileId", "requestedByUserId", "idempotencyKey", "planRevision", "updatedAt") VALUES ('task', 'org', 'plan', 'profile-a', 'actor', 'fixture-task', 1, now());
INSERT INTO "AmazonAdsEntityRecord" (id, "organizationId", "profileId", "entityType", "externalId", payload, "sourceTaskId") VALUES ('entity-a', 'org', 'profile-a', 'SP:campaign', '101', '{"name":"Legacy fixture"}', 'task');
INSERT INTO "AmazonAdsReportVersion" (id, "organizationId", "profileId", "sourceTaskId", "updatedAt") VALUES ('version-a', 'org', 'profile-a', 'task', now());
INSERT INTO "AmazonAdsReportFact" (id, "organizationId", "profileId", "reportType", "adProduct", "reportDate", "factKey", "apiVersion", "sourceTaskId", "rawDimensions", "versionId") VALUES
 ('fact-legacy', 'org', 'profile-a', 'fixture_campaign', 'SPONSORED_PRODUCTS', '2026-11-01', 'same-key', 'fixture', 'task', '{}', NULL),
 ('fact-version', 'org', 'profile-a', 'fixture_campaign', 'SPONSORED_PRODUCTS', '2026-11-01', 'same-key', 'fixture', 'task', '{}', 'version-a');
