import { writeFileSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";
import { prisma } from "../src/lib/db/prisma";
import { decryptAmazonSpApiCredentials } from "../src/lib/amazon/integration-secrets";
import { AmazonSpApiClient, AmazonSpApiError, type AmazonRequestEvent } from "../src/lib/amazon/sp-api-client";
import { assertAmazonAction, assertAmazonScopeAdmin } from "../src/lib/amazon-sync/data-access";
import { seal } from "../src/lib/amazon-sync/approval-policy";
import { parseObservationPolicy } from "../src/lib/amazon-sync/observation-policy";
import { parseProductDetail } from "../src/lib/amazon-sync/product-observations";

const scope = { organizationId: "amazon-live-local", workspaceId: "default" };
const url = new URL(process.env.DATABASE_URL ?? "invalid:");
if (process.argv[2] !== "--approved-eight-reads" || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local") throw new Error("Explicit reviewed local target required");
async function main() {
  const auth = await prisma.amazonSpApiAuthorization.findFirstOrThrow({ where: { ...scope, name: "aoocy-us", status: "CONFIGURED", revision: 3 } });
  await assertAmazonScopeAdmin(scope, auth.updatedByUserId);
  await assertAmazonAction(scope, auth.updatedByUserId, "approve");
  const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id, resource: "catalog", marketplaceId: { in: ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8", "A2Q3Y263D00KWC"] } }, orderBy: { marketplaceId: "asc" } });
  if (sources.length !== 4 || !auth.amazonSellerId) throw new Error("Reviewed scope changed");
  let events: AmazonRequestEvent[] = [];
  const client = new AmazonSpApiClient({ ...decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: auth.id }), region: auth.awsRegion, endpoint: auth.endpoint }, { requestTimeoutMs: 20000, onResponse: e => events.push(e), cacheScope: `product-detail-probe:${auth.id}:${auth.revision}` });
  const evidence: unknown[] = [];
  for (const source of sources) {
    const item = await prisma.amazonCatalogSnapshot.findFirstOrThrow({ where: { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, sourceRunId: source.activeRunId!, NOT: { asin: "" } }, orderBy: { sellerSku: "asc" }, select: { sellerSku: true, asin: true } });
    for (const resource of ["listing_details", "catalog_items"] as const) {
      const current = await prisma.amazonSpApiAuthorization.findFirst({ where: { ...scope, id: auth.id, revision: auth.revision, status: "CONFIGURED" } });
      if (!current) throw new Error("Authorization changed");
      events = [];
      try {
        const response = resource === "listing_details" ? await client.getListingDetail({ sellerId: auth.amazonSellerId, sellerSku: item.sellerSku, marketplaceId: source.marketplaceId }) : await client.getCatalogDetail({ asin: item.asin, marketplaceId: source.marketplaceId });
        let parsed = false;
        try { const policy = parseObservationPolicy({ resource, applicationId: "probe", maxRequests: 1, maxRows: 1, requestsPerSecond: .2, ...(resource === "listing_details" ? { sellerSkus: [item.sellerSku] } : { asins: [item.asin] }) });
          if (policy.resource === "listing_details" || policy.resource === "catalog_items") { parseProductDetail(response.rawBody, policy, 0, source.marketplaceId); parsed = true; }
        } catch { /* Distinguish HTTP access from parser acceptance. */ }
        const result = { resource, marketplaceId: source.marketplaceId, events: events.filter(e => e.operation !== "LWA"), parsed, bytes: Buffer.byteLength(response.rawBody) };
        evidence.push({ ...result, rawBody: response.rawBody });
        console.log(JSON.stringify(result));
      } catch (error) {
        const result = { resource, marketplaceId: source.marketplaceId, status: error instanceof AmazonSpApiError ? error.status : null, code: error instanceof AmazonSpApiError ? error.upstreamCode : "LOCAL_ERROR", parsed: false };
        evidence.push(result); console.log(JSON.stringify(result));
      }
      await pause(5000);
    }
  }
  writeFileSync("tmp/amazon-live-private/product-detail-probe.enc", seal({ checkedAt: new Date().toISOString(), authorizationId: auth.id, authorizationRevision: auth.revision, evidence }, scope, "product-detail-probe", "amazon-product-detail-probe.v1"), { mode: 0o600 });
}
main().catch(error => { console.error(JSON.stringify({ failed: true, name: error.name, code: error.code ?? null })); process.exitCode = 1; }).finally(() => prisma.$disconnect());
