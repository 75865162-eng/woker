import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "../src/lib/amazon-sync/change-approval";
import { unseal } from "../src/lib/amazon-sync/approval-policy";
import { productAccessEvidence } from "../src/lib/amazon-sync/product-access-evidence";

// Approved eight-source local configuration only. Never enable or start work.
const scope = { organizationId: "amazon-live-local", workspaceId: "default" };
const url = new URL(process.env.DATABASE_URL ?? "invalid:");
if (process.argv[2] !== "--approved-eight-disabled-sources" || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local") throw new Error("Reviewed local target required");
type Probe = { resource: "listing_details" | "catalog_items"; marketplaceId: string; parsed: boolean; events?: Array<{ status: number | null; requestId: string | null; operation: string }> };
async function main() {
  const proof = unseal(readFileSync("tmp/amazon-live-private/product-detail-probe.enc", "utf8"), scope, "product-detail-probe", "amazon-product-detail-probe.v1") as { authorizationId: string; authorizationRevision: number; checkedAt: string; evidence: Probe[] };
  if (Date.now() - Date.parse(proof.checkedAt) > 3600000 || !Number.isFinite(Date.parse(proof.checkedAt)) || Date.parse(proof.checkedAt) > Date.now() || proof.evidence.length !== 8) throw new Error("Probe stale or incomplete");
  const auth = await prisma.amazonSpApiAuthorization.findFirstOrThrow({ where: { ...scope, id: proof.authorizationId, revision: proof.authorizationRevision, status: "CONFIGURED", name: "aoocy-us" } });
  const catalog = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id, resource: "catalog", marketplaceId: { in: ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8", "A2Q3Y263D00KWC"] } }, orderBy: { marketplaceId: "asc" } });
  if (catalog.length !== 4) throw new Error("Source scope changed");
  const peers = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id }, select: { orderPolicy: true, financePolicy: true, returnsPolicy: true } });
  const apps = [...new Set(peers.flatMap(p => [p.orderPolicy, p.financePolicy, p.returnsPolicy]).flatMap(p => p && typeof p === "object" && !Array.isArray(p) && typeof p.applicationId === "string" ? [p.applicationId] : []))];
  if (apps.length !== 1) throw new Error("Application quota identity ambiguous");
  const commands = catalog.flatMap(source => (["listing_details", "catalog_items"] as const).map(resource => {
    const p = proof.evidence.find(p => p.marketplaceId === source.marketplaceId && p.resource === resource);
    const event = p?.events?.find(e => e.operation === (resource === "listing_details" ? "getListingsItem" : "getCatalogItem"));
    if (!p?.parsed || event?.status !== 200 || !event.requestId) throw new Error("No successful parsed probe for target");
    const accessEvidence = productAccessEvidence({ ...scope, authorizationId: auth.id, authorizationRevision: auth.revision, marketplaceId: source.marketplaceId, resource }, { status: 200, parsed: true, requestId: event.requestId }, new Date(proof.checkedAt));
    return { action: "save-source", authorizationId: auth.id, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource, freshnessMinutes: 1440, enabled: false, domainPolicy: { resource, applicationId: apps[0], maxRequests: 500, maxRows: 1000, requestsPerSecond: .2, discovery: { mode: "catalog_snapshot", sourceId: source.id, maxObjects: 1000, batchSize: 100 }, accessEvidence, ...(resource === "listing_details" ? { sellerSkus: [] } : { asins: [] }) } };
  }));
  // Refuse unexpected pre-existing configuration rather than overwrite it.
  if (await prisma.amazonSyncDataSource.count({ where: { ...scope, authorizationId: auth.id, resource: { in: ["listing_details", "catalog_items"] } } })) throw new Error("Detail sources already exist; review before update");
  for (const command of commands) {
    const request = await requestChange(scope, auth.updatedByUserId, command);
    const decision = await decideChange(scope, auth.updatedByUserId, String(request.id), "APPROVED", "用户批准商品详情方案：仅本机四站八个禁用来源，真实八次HTTP200证据；不启用、不启动。");
    if (decision.status !== "APPROVED") throw new Error("Approval stale");
    await applyChange(scope, auth.updatedByUserId, String(request.id));
    const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, authorizationId: auth.id, sellerAccountId: command.sellerAccountId, marketplaceId: command.marketplaceId, resource: command.resource } });
    if (source.enabled || await prisma.amazonSyncRun.count({ where: { ...scope, sourceId: source.id } }) || await prisma.amazonSyncPlanTarget.count({ where: { ...scope, sourceId: source.id } })) throw new Error("Disabled-source boundary failed");
    console.log(JSON.stringify({ sourceId: source.id, resource: source.resource, marketplaceId: source.marketplaceId, revision: source.revision, enabled: source.enabled, approvalId: request.id, tasks: 0, plans: 0 }));
  }
}
main().catch(error => { console.error(JSON.stringify({ stopped: true, name: error.name, code: error.code ?? null, reason: error.name === "SyncInputError" ? error.message : undefined })); process.exitCode = 1; }).finally(() => prisma.$disconnect());
