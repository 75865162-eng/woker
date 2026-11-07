// Controlled local execution through existing audited approvals. Never print credentials or ASIN lists.
import { prisma } from "../src/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "../src/lib/amazon-sync/change-approval";
import { discoverProductObjects } from "../src/lib/amazon-sync/product-discovery";
import { brandCollectionWindows, type BrandCollection } from "../src/lib/amazon-sync/brand-collection";
import { brandReports } from "../src/lib/amazon-sync/brand-reports";
import { reportTimeZone } from "../src/lib/amazon-sync/date-range";
import { unseal } from "../src/lib/amazon-sync/approval-policy";
import { readBrandCollection } from "../src/lib/amazon-sync/brand-collection-query";
const scope = { organizationId: "amazon-live-local", workspaceId: "default" };
const sites = ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8", "A2Q3Y263D00KWC"];
const phase = process.argv[2];
const url = new URL(process.env.DATABASE_URL ?? "invalid:");
if (!["--preview", "--apply", "--status", "--next", "--enable-plan", "--retry-downloaded"].includes(phase) || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local") throw Error("Reviewed local target required");
async function main() {
  const auth = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: "3895911f-89c4-4ebd-8212-dc58bede447e" } });
  if (auth.organizationId !== scope.organizationId || auth.workspaceId !== scope.workspaceId || auth.revision !== 3 || auth.status !== "CONFIGURED") throw Error("Authorization changed");
  async function approved(command: Record<string, unknown>) {
    const request = await requestChange(scope, auth.updatedByUserId, command);
    await decideChange(scope, auth.updatedByUserId, String(request.id), "APPROVED", "用户批准本机四站品牌分析真实同步验收：2026-10-25 至 2026-10-31，五类周报、当前商品快照全部候选 ASIN、每任务最多30请求/10000行，账号设置统一权限，不修改凭据。");
    await applyChange(scope, auth.updatedByUserId, String(request.id));
  }
  if (phase === "--status" || phase === "--next" || phase === "--enable-plan" || phase === "--retry-downloaded") {
    const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id, resource: "brand_analytics", marketplaceId: { in: sites } }, include: { authorization: { select: { revision: true } } } });
    for (const source of sources) {
      const coverage = await readBrandCollection(prisma, scope, source);
      const recent = await prisma.amazonSyncRun.findMany({ where: { ...scope, sourceId: source.id }, select: { id: true, status: true, stage: true, error: true, apiRequests: true, processedCount: true, nextAttemptAt: true }, orderBy: { startedAt: "desc" }, take: 1 });
      console.log(JSON.stringify({ marketplaceId: source.marketplaceId, sourceId: source.id, completed: coverage?.completed, total: coverage?.total, next: coverage?.next ? { kind: coverage.next.reportKind, status: coverage.next.status, taskId: coverage.next.taskId } : null, recent }));
      if (phase === "--retry-downloaded" && coverage?.next?.status === "FAILED") {
        const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: coverage.next.taskId!, sourceId: source.id, status: "FAILED" } });
        const state = unseal(run.checkpointCiphertext!, scope, run.id, "amazon-observation-state.v1").state as { stage?: string; reportId?: string; requests?: number };
        const policy = (run.frozenScope as { domainPolicy?: { from?: string; to?: string; reportKind?: string } }).domainPolicy;
        if (state.stage !== "DOWNLOAD" || !state.reportId || (state.requests ?? 30) >= 30 || policy?.from !== "2026-10-25" || policy.to !== "2026-10-31" || !["repeat_purchase", "search_catalog"].includes(policy.reportKind ?? "")) throw Error("Only reviewed repeat/catalog report download checkpoints can resume");
        await approved({ action: "control-task", id: run.id, control: "retry" });
        console.log(JSON.stringify({ marketplaceId: source.marketplaceId, taskId: run.id, resumedExistingReportDownload: true }));
      }
      if (phase === "--enable-plan") {
        const existing = await prisma.amazonSyncSchedule.findFirst({ where: { ...scope, resource: "brand_analytics", targets: { some: { sourceId: source.id } } } });
        if (!existing) await approved({ action: "save-plan", name: "品牌分析 · 2026-10-25至31固定周验收", resource: "brand_analytics", enabled: true, mode: "snapshot", intervalMinutes: 1440, priority: 4, maxAttempts: 3, retentionDays: 3650, sourceIds: [source.id] });
      }
      if (phase === "--next" && coverage?.next?.status === "MISSING") await approved({ action: "run", sourceIds: [source.id] });
    }
    return;
  }
  const catalogSources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id, resource: "catalog", enabled: true, marketplaceId: { in: sites } }, include: { authorization: { select: { revision: true, amazonSellerId: true } } }, orderBy: { marketplaceId: "asc" } });
  if (catalogSources.length !== 4) throw Error("Catalog scope changed");
  const manifests = [];
  for (const catalog of catalogSources) {
    const manifest = await discoverProductObjects(prisma, scope, { ...catalog, id: "brand-manifest-preview" }, { resource: "catalog_items", applicationId: "preview", asins: [], discovery: { mode: "catalog_snapshot", sourceId: catalog.id, maxObjects: 1000, batchSize: 100 }, requestsPerSecond: .01, maxRequests: 1000, maxRows: 1000 });
    if (!manifest) throw Error("Catalog manifest unavailable");
    const sibling = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, authorizationId: auth.id, sellerAccountId: catalog.sellerAccountId, marketplaceId: catalog.marketplaceId, resource: "listing_details" }, select: { domainPolicy: true } });
    const applicationId = (sibling.domainPolicy as { applicationId?: string } | null)?.applicationId;
    if (!applicationId) throw Error("Application budget identity missing");
    const collection: BrandCollection = { from: "2026-10-25", to: "2026-10-31", asins: manifest.ids, maxTasks: 100, selections: Object.keys(brandReports).map(reportKind => ({ reportKind: reportKind as keyof typeof brandReports, reportPeriod: "WEEK" })) };
    const count = brandCollectionWindows(collection).length;
    manifests.push({ catalog, collection, applicationId });
    console.log(JSON.stringify({ marketplaceId: catalog.marketplaceId, catalogRunId: manifest.runId, candidateAsins: manifest.total, manifestDigest: manifest.digest, reports: count, maxRequests: count * 30, from: collection.from, to: collection.to }));
  }
  if (phase === "--preview") return;
  for (const { catalog, collection, applicationId } of manifests) {
    const existing = await prisma.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId: catalog.sellerAccountId, marketplaceId: catalog.marketplaceId, resource: "brand_analytics" } });
    if (existing) throw Error("Brand source exists; inspect status before changing scope");
    await approved({ action: "save-source", authorizationId: auth.id, sellerAccountId: catalog.sellerAccountId, marketplaceId: catalog.marketplaceId, resource: "brand_analytics", enabled: true, freshnessMinutes: 1440,
      domainPolicy: { resource: "brand_analytics", applicationId, reportKind: "search_terms", reportPeriod: "WEEK", from: collection.from, to: collection.to, asins: [], maxRequests: 30, maxRows: 10000, requestsPerSecond: .01, marketplaceTimeZone: reportTimeZone(catalog.marketplaceId), collection } });
    const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, sellerAccountId: catalog.sellerAccountId, marketplaceId: catalog.marketplaceId, resource: "brand_analytics" } });
    await approved({ action: "run", sourceIds: [source.id] });
    console.log(JSON.stringify({ marketplaceId: catalog.marketplaceId, sourceId: source.id, firstTaskApproved: true, automaticPlanCreated: false }));
  }
}
main().catch(error => { console.error(JSON.stringify({ stopped: true, name: error.name, reason: error.name === "SyncInputError" ? error.message : undefined })); process.exitCode = 1; }).finally(() => prisma.$disconnect());
