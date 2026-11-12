import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { assertAmazonAction, assertAmazonScopeAdmin } from "./data-access";
import { automaticBackfillStart, automaticMarketplaces } from "./automatic-schedule";
import { automaticAdapterFreshnessMinutes, automaticAdapterHasRequiredPolicy, automaticAdapterHasRequiredRoles, automaticSourcePolicyFields, marketplaceAutomaticAdapters, sellerAutomaticAdapters } from "./automatic-adapters";
import { reportTimeZone } from "./date-range";
import { scopeLock } from "./service";
import { assignNewAutomaticAccount } from "./automatic-account-access";
import { SyncInputError, type SyncScope } from "./policy";

const domains = marketplaceAutomaticAdapters.map(adapter => adapter.resource);
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Existing validated credentials are sufficient for token-scoped read APIs.
 * No synthetic Amazon seller identity, role attestation or cross-account merge.
 * No source policy, paused plan, cursor or existing ownership is overwritten.
 */
export async function ensureAutomaticConnections(scopes: SyncScope[], now: Date, authorizationId?: string) {
  if (!scopes.length) return;
  const authorizations = await prisma.amazonSpApiAuthorization.findMany({ where: { OR: scopes, ...(authorizationId ? { id: authorizationId } : {}), status: "CONFIGURED", lastValidatedAt: { not: null } }, select: { id: true, organizationId: true, workspaceId: true } });
  for (const candidate of authorizations) {
    const scope = { organizationId: candidate.organizationId, workspaceId: candidate.workspaceId };
    try {
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope);
        const auth = await tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, id: candidate.id, status: "CONFIGURED", lastValidatedAt: { not: null } } });
        if (!auth) return;
        await assertAmazonScopeAdmin(scope, auth.updatedByUserId, tx);
        await assertAmazonAction(scope, auth.updatedByUserId, "create", tx);
        await assertAmazonAction(scope, auth.updatedByUserId, "approve", tx);
        const sites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations }).filter(s => automaticMarketplaces.has(s.marketplaceId));
        if (!sites.length) return;
        const old = await tx.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id }, select: { id: true, sellerAccountId: true, marketplaceId: true, resource: true, orderPolicy: true, financePolicy: true, returnsPolicy: true } });
        const missing = sites.flatMap(site => domains.filter(resource => !old.some(s => s.marketplaceId === site.marketplaceId && s.resource === resource)));
        const missingSellerAdapters = sellerAutomaticAdapters.filter(adapter => !old.some(s => s.resource === adapter.resource));
        if (!missing.length && !missingSellerAdapters.length) return;
        const credentials = decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: auth.id });
        const peerApp = old.flatMap(s => [s.orderPolicy, s.financePolicy, s.returnsPolicy]).find(v => v && typeof v === "object" && !Array.isArray(v) && typeof v.applicationId === "string") as { applicationId: string } | undefined;
        const applicationId = peerApp?.applicationId ?? `lwa-${createHash("sha256").update(credentials.lwaClientId).digest("hex")}`;
        const identities = await tx.amazonSellerIdentity.findMany({ where: { ...scope, authorizationId: auth.id }, select: { marketplaceId: true, sellerAccountId: true } });
        const known = [...new Set([...old, ...identities].map(s => s.sellerAccountId))];
        // Preserve legacy per-site identity mappings. New token accounts use one regional store.
        const accountKey = `amazon-authorization:${auth.id}`;
        const regionCode = auth.awsRegion === "us-east-1" ? "NA" : auth.awsRegion === "eu-west-1" ? "EU" : "FE";
        let account = known.length === 1 ? await tx.sellerAccount.findFirst({ where: { ...scope, id: known[0] } }) : known.length === 0 ? await tx.sellerAccount.findUnique({ where: { organizationId_workspaceId_accountKey_marketplaceCode: { ...scope, accountKey, marketplaceCode: regionCode } } }) : null;
        if (!known.length && !account) {
          account = await tx.sellerAccount.create({ data: { ...scope, id: randomUUID(), accountKey, displayName: auth.name, marketplaceCode: regionCode } });
          await assignNewAutomaticAccount(tx, scope, auth.updatedByUserId, account.id);
        }
        const bindings: Array<{ marketplaceId: string; sellerAccountId: string }> = [];
        let created = 0;
        const capacityDeferred: string[] = [];
        let count = await tx.amazonSyncDataSource.count({ where: scope });
        for (const site of sites) {
          const ids = [...new Set([...old, ...identities].filter(s => s.marketplaceId === site.marketplaceId).map(s => s.sellerAccountId))];
          if (ids.length > 1) throw new SyncInputError("现有站点绑定冲突，自动连接未修改历史归属。", 409);
          const sellerAccountId = ids[0] ?? account?.id;
          if (!sellerAccountId) continue;
          if (await tx.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId, marketplaceId: site.marketplaceId, authorizationId: { not: auth.id } }, select: { id: true } })) throw new SyncInputError("现有店铺绑定另一个授权，不能自动合并。", 409);
          bindings.push({ marketplaceId: site.marketplaceId, sellerAccountId });
          for (const resource of domains) {
            if (old.some(s => s.marketplaceId === site.marketplaceId && s.resource === resource)) continue;
            const adapter = marketplaceAutomaticAdapters.find(candidate => candidate.resource === resource);
            if (!adapter) continue;
            if (adapter.supportedMarketplaceIds && !adapter.supportedMarketplaceIds.includes(site.marketplaceId)) continue;
            if (adapter.requiresVerifiedSeller && (!auth.amazonSellerId || !auth.identityVerifiedAt)) continue;
            const catalog = adapter.requiresMarketplaceCatalogSource ? await tx.amazonSyncDataSource.findFirst({ where: { ...scope, authorizationId: auth.id, sellerAccountId, marketplaceId: site.marketplaceId, resource: "catalog" }, select: { id: true } }) : null;
            if (adapter.requiresMarketplaceCatalogSource && !catalog) continue;
            if (!automaticAdapterHasRequiredRoles(adapter, !!auth.rolesAttestedAt, auth.approvedRoles)) continue;
            const policies = adapter.createMarketplacePolicy?.({ now, initialFrom: automaticBackfillStart(now), applicationId, marketplaceId: site.marketplaceId, marketplaceTimeZone: reportTimeZone(site.marketplaceId), ...(catalog ? { catalogSourceId: catalog.id } : {}) }) ?? {};
            if (!automaticAdapterHasRequiredPolicy(adapter, policies)) continue;
            if (count >= 200) { capacityDeferred.push(`${site.marketplaceId}:${resource}`); continue; }
            count++;
            await tx.amazonSyncDataSource.create({ data: { ...scope, id: randomUUID(), authorizationId: auth.id, sellerAccountId, marketplaceId: site.marketplaceId, resource, enabled: true, freshnessMinutes: automaticAdapterFreshnessMinutes(adapter),
              ...Object.fromEntries(Object.entries(automaticSourcePolicyFields(policies)).map(([key, value]) => [key, json(value)])) } });
            created++;
          }
        }
        // Finance is seller-wide: one source, all verified sales sites, same internal account.
        // A legacy split mapping remains untouched and requires explicit reconciliation.
        const allSites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations }).filter(s => automaticMarketplaces.has(s.marketplaceId));
        if (bindings.length === allSites.length && bindings.length && new Set(bindings.map(s => s.sellerAccountId)).size === 1) for (const adapter of missingSellerAdapters) {
          if (!adapter.createSellerPolicy) continue;
          if (adapter.requiresVerifiedSeller && (!auth.amazonSellerId || !auth.identityVerifiedAt)) continue;
          if (!automaticAdapterHasRequiredRoles(adapter, !!auth.rolesAttestedAt, auth.approvedRoles)) continue;
          const policies = adapter.createSellerPolicy({ now, initialFrom: automaticBackfillStart(now), applicationId, marketplaces: bindings.map(binding => ({ ...binding, marketplaceTimeZone: reportTimeZone(binding.marketplaceId) })) });
          if (!automaticAdapterHasRequiredPolicy(adapter, policies)) continue;
          if (count >= 200) { capacityDeferred.push(`seller:${adapter.resource}`); continue; }
          count++;
          // Seller-level sources anchor to one marketplace only for local ownership.
          await tx.amazonSyncDataSource.create({ data: { ...scope, id: randomUUID(), authorizationId: auth.id, sellerAccountId: bindings[0].sellerAccountId, marketplaceId: bindings[0].marketplaceId, resource: adapter.resource, enabled: true, freshnessMinutes: automaticAdapterFreshnessMinutes(adapter),
            ...Object.fromEntries(Object.entries(automaticSourcePolicyFields(policies)).map(([key, value]) => [key, json(value)])) } });
          created++;
        }
        if (capacityDeferred.length) {
          const signature = createHash("sha256").update(JSON.stringify([auth.revision, count, capacityDeferred])).digest("hex");
          const previous = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, entityId: auth.id, action: "amazon.sync.connection.capacity-deferred" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { metadata: true } });
          if ((previous?.metadata as { signature?: string } | null)?.signature !== signature) await tx.auditLog.create({ data: {
            organizationId: scope.organizationId, userId: auth.updatedByUserId, action: "amazon.sync.connection.capacity-deferred", entityType: "AmazonSpApiAuthorization", entityId: auth.id,
            metadata: { workspaceId: scope.workspaceId, authorizationRevision: auth.revision, code: "SOURCE_CAPACITY", limit: 200, sourceCount: count, deferredResources: capacityDeferred, signature, retry: "AUTOMATIC_NEXT_DISCOVERY" },
          } });
        }
        if (created) await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: auth.updatedByUserId, action: "amazon.sync.connection.automatic_bound", entityType: "AmazonSpApiAuthorization", entityId: auth.id, metadata: { workspaceId: scope.workspaceId, sourceCount: created, marketplaceIds: bindings.map(s => s.marketplaceId), sellerIdentityKnown: !!auth.amazonSellerId, roleEvidence: "UPSTREAM_ENFORCED_READ_ONLY", initialFrom: automaticBackfillStart(now) } } });
      }, { timeout: 15000 });
    } catch { console.error(`[amazon-sync-center] automatic connection deferred for authorization ${candidate.id}`); }
  }
}
