import { notificationTypes } from "./notification-types";
import { latestClosedBrandWindow } from "./automatic-brand";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { assertAmazonAction, assertAmazonScopeAdmin } from "./data-access";
import { automaticBackfillStart, automaticMarketplaces } from "./automatic-schedule";
import { localDate, shiftDate, reportTimeZone } from "./date-range";
import { parseOrderSyncPolicy } from "./orders";
import { newFinanceRetentionStart, parseFinancePolicy } from "./finance";
import { parseReturnPolicy, returnReportTypes } from "./returns";
import { parseObservationPolicy } from "./observation-policy";
import { scopeLock } from "./service";
import { SyncInputError, type SyncScope } from "./policy";

const domains = ["catalog", "inventory", "orders", "sales_traffic", "returns", "settlements", "reimbursements", "inventory_age", "inventory_events", "listing_details", "catalog_items", "pricing", "fulfillment", "buy_box_history", "brand_analytics"] as const;
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
        const needsFinance = !old.some(s => s.resource === "finance");
        const needsNotifications = !old.some(s => s.resource === "notifications");
        if (!missing.length && !needsFinance && !needsNotifications) return;
        const credentials = decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: auth.id });
        const peerApp = old.flatMap(s => [s.orderPolicy, s.financePolicy, s.returnsPolicy]).find(v => v && typeof v === "object" && !Array.isArray(v) && typeof v.applicationId === "string") as { applicationId: string } | undefined;
        const applicationId = peerApp?.applicationId ?? `lwa-${createHash("sha256").update(credentials.lwaClientId).digest("hex")}`;
        const identities = await tx.amazonSellerIdentity.findMany({ where: { ...scope, authorizationId: auth.id }, select: { marketplaceId: true, sellerAccountId: true } });
        const known = [...new Set([...old, ...identities].map(s => s.sellerAccountId))];
        // Preserve legacy per-site identity mappings. New token accounts use one regional store.
        const accountKey = `amazon-authorization:${auth.id}`;
        const regionCode = auth.awsRegion === "us-east-1" ? "NA" : auth.awsRegion === "eu-west-1" ? "EU" : "FE";
        const account = known.length === 1 ? await tx.sellerAccount.findFirst({ where: { ...scope, id: known[0] } }) : known.length === 0 ? await tx.sellerAccount.upsert({ where: { organizationId_workspaceId_accountKey_marketplaceCode: { ...scope, accountKey, marketplaceCode: regionCode } }, create: { ...scope, id: randomUUID(), accountKey, displayName: auth.name, marketplaceCode: regionCode }, update: {} }) : null;
        const bindings: Array<{ marketplaceId: string; sellerAccountId: string }> = [];
        let created = 0;
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
            const productDetails = resource === "listing_details" || resource === "catalog_items" || resource === "pricing";
            if (productDetails && (!auth.amazonSellerId || !auth.identityVerifiedAt)) continue;
            if (++count > 200) throw new SyncInputError("自动数据源超过当前工作区200个容量上限。", 409);
            const common = { initialFrom: automaticBackfillStart(now), applicationId, marketplaceTimeZone: reportTimeZone(site.marketplaceId), windowMinutes: 1440, overlapSeconds: 60, safetyLagSeconds: 180 };
            const orderPolicy = resource === "orders" ? parseOrderSyncPolicy({ ...common, requiredRoles: ["Inventory and Order Tracking"], requestsPerSecond: .0056, burst: 1, statusMapping: {}, details: { includedData: [], requiredRoles: [], purpose: "operations_order_items", requestsPerSecond: .2, burst: 1, maxOrders: 5000, backfillExisting: true } }) : undefined;
            const returnsPolicy = resource === "returns" ? parseReturnPolicy({ ...common, windowMinutes: 43200, safetyLagSeconds: 86400, reportType: returnReportTypes.FBA_RECEIVED, batchSize: 250, maxRows: 50000, pollMaxAttempts: 60, pollDeadlineMinutes: 1440, pollBaseSeconds: 60, pollMaxSeconds: 600, budgets: { createReport: { requestsPerSecond: .01, burst: 1 }, getReport: { requestsPerSecond: 1, burst: 1 }, getReportDocument: { requestsPerSecond: .01, burst: 1 } } }) : undefined;
            const catalog = productDetails ? await tx.amazonSyncDataSource.findFirst({ where: { ...scope, authorizationId: auth.id, sellerAccountId, marketplaceId: site.marketplaceId, resource: "catalog" }, select: { id: true } }) : null;
            const firstBuyBoxDay = shiftDate(localDate(now, reportTimeZone(site.marketplaceId)), -730);
            const domainPolicy = resource === "brand_analytics" ? parseObservationPolicy({ resource, applicationId, requestsPerSecond: .01, maxRequests: 500, maxRows: 50000, asins: [], automaticDiscovery: true, reportKind: "search_terms", reportPeriod: "DAY", from: latestClosedBrandWindow(localDate(now, reportTimeZone(site.marketplaceId)), "QUARTER").from, to: latestClosedBrandWindow(localDate(now, reportTimeZone(site.marketplaceId)), "QUARTER").from, marketplaceTimeZone: reportTimeZone(site.marketplaceId), brandEligibilityAttested: false }) : resource === "buy_box_history" ? parseObservationPolicy({ resource, applicationId, requestsPerSecond: .01, maxRequests: 500, maxRows: 50000, asins: [], allAsins: true, from: firstBuyBoxDay, to: firstBuyBoxDay, marketplaceTimeZone: reportTimeZone(site.marketplaceId) }) : resource === "fulfillment" ? parseObservationPolicy({ resource, applicationId, requestsPerSecond: .2, maxRequests: 1000, maxRows: 50000, planIds: [], discoverPlans: true }) : productDetails && catalog ? parseObservationPolicy({ resource, applicationId, requestsPerSecond: resource === "pricing" ? .03 : .2, maxRequests: 500, maxRows: 50000, discovery: { mode: "catalog_snapshot", sourceId: catalog.id, maxObjects: resource === "pricing" ? 1000 : 500, batchSize: 100 }, ...(resource === "listing_details" ? { sellerSkus: [] } : { asins: [] }) }) : undefined;
            if (productDetails && !domainPolicy) continue;
            await tx.amazonSyncDataSource.create({ data: { ...scope, id: randomUUID(), authorizationId: auth.id, sellerAccountId, marketplaceId: site.marketplaceId, resource, enabled: true, freshnessMinutes: resource === "inventory" ? 360 : 2880, ...(orderPolicy ? { orderPolicy: json(orderPolicy) } : {}), ...(returnsPolicy ? { returnsPolicy: json(returnsPolicy) } : {}), ...(domainPolicy ? { domainPolicy: json(domainPolicy) } : {}) } });
            created++;
          }
        }
        // Finance is seller-wide: one source, all verified sales sites, same internal account.
        // A legacy split mapping remains untouched and requires explicit reconciliation.
        const allSites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations }).filter(s => automaticMarketplaces.has(s.marketplaceId));
        if (needsFinance && bindings.length === allSites.length && bindings.length && new Set(bindings.map(s => s.sellerAccountId)).size === 1) {
          if (++count > 200) throw new SyncInputError("自动数据源超过当前工作区200个容量上限。", 409);
          const start = newFinanceRetentionStart(automaticBackfillStart(now), now);
          const policy = parseFinancePolicy({ initialFrom: start.initialFrom, applicationId, windowMinutes: 43200, overlapSeconds: 60, safetyLagSeconds: 180, requestsPerSecond: .5, burst: 1, sellerWide: true, collectUnattributed: true, marketplaces: bindings.map(s => ({ marketplaceId: s.marketplaceId, marketplaceTimeZone: reportTimeZone(s.marketplaceId) })) });
          await tx.amazonSyncDataSource.create({ data: { ...scope, id: randomUUID(), authorizationId: auth.id, sellerAccountId: bindings[0].sellerAccountId, marketplaceId: bindings[0].marketplaceId, resource: "finance", enabled: true, freshnessMinutes: 2880, financePolicy: json(policy), ...(start.retentionGap ? { coverage: json({ retentionGaps: [start.retentionGap], historicalComplete: false }) } : {}) } });
          created++;
        }
        if (needsNotifications && bindings.length === allSites.length && bindings.length && new Set(bindings.map(s => s.sellerAccountId)).size === 1) {
          if (++count > 200) throw new SyncInputError("自动数据源超过当前工作区200个容量上限。", 409);
          const domainPolicy = parseObservationPolicy({ resource: "notifications", applicationId, notificationTypes: [...notificationTypes], maxRequests: 500, maxRows: 50000, requestsPerSecond: .2 });
          // marketplaceId anchors local ownership only; payload remains explicitly seller-wide.
          await tx.amazonSyncDataSource.create({ data: { ...scope, id: randomUUID(), authorizationId: auth.id, sellerAccountId: bindings[0].sellerAccountId, marketplaceId: bindings[0].marketplaceId, resource: "notifications", enabled: true, freshnessMinutes: 2880, domainPolicy: json(domainPolicy) } });
          created++;
        }
        if (created) await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: auth.updatedByUserId, action: "amazon.sync.connection.automatic_bound", entityType: "AmazonSpApiAuthorization", entityId: auth.id, metadata: { workspaceId: scope.workspaceId, sourceCount: created, marketplaceIds: bindings.map(s => s.marketplaceId), sellerIdentityKnown: !!auth.amazonSellerId, roleEvidence: "UPSTREAM_ENFORCED_READ_ONLY", initialFrom: automaticBackfillStart(now) } } });
      }, { timeout: 15000 });
    } catch { console.error(`[amazon-sync-center] automatic connection deferred for authorization ${candidate.id}`); }
  }
}
