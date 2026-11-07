import { prisma } from "../src/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "../src/lib/amazon-sync/change-approval";
import { discoverProductObjects } from "../src/lib/amazon-sync/product-discovery";
import { parseObservationPolicy, assertObservationRoles } from "../src/lib/amazon-sync/observation-policy";
const scope = { organizationId: "amazon-live-local", workspaceId: "default" };
const url = new URL(process.env.DATABASE_URL ?? "invalid:");
const phase = process.argv[2];
if (!["--refresh-catalog", "--start-details", "--status"].includes(phase) || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local") throw Error("Reviewed local target required");
const sites = ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8", "A2Q3Y263D00KWC"];
async function main() {
  const auth = await prisma.amazonSpApiAuthorization.findFirstOrThrow({ where: { ...scope, id: "3895911f-89c4-4ebd-8212-dc58bede447e", name: "aoocy-us", revision: 3, status: "CONFIGURED" } });
  async function approved(command: Record<string, unknown>) {
    const request = await requestChange(scope, auth.updatedByUserId, command);
    const decision = await decideChange(scope, auth.updatedByUserId, String(request.id), "APPROVED", "用户批准本机四站商品目录与Listing详情首轮真实采集；先刷新当前身份快照，再按既定对象上限、限流完整发布。");
    if (decision.status !== "APPROVED") throw Error("Approval became stale");
    await applyChange(scope, auth.updatedByUserId, String(request.id));
    return request.id;
  }
  if (phase === "--refresh-catalog") {
    const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id, resource: "catalog", enabled: true, marketplaceId: { in: sites } }, orderBy: { marketplaceId: "asc" } });
    if (sources.length !== 4) throw Error("Catalog scope changed");
    for (const source of sources) {
      const active = await prisma.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT", "PAUSED"] } }, select: { id: true } });
      if (active) { console.log(JSON.stringify({ resource: "catalog", marketplaceId: source.marketplaceId, existingTaskId: active.id })); continue; }
      const approvalId = await approved({ action: "run", sourceIds: [source.id] });
      const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: String(approvalId), sourceId: source.id } });
      console.log(JSON.stringify({ resource: "catalog", marketplaceId: source.marketplaceId, taskId: run.id, status: run.status, approvalId }));
    }
  }
  if (phase === "--start-details") {
    const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id, resource: { in: ["listing_details", "catalog_items"] }, marketplaceId: { in: sites } }, include: { authorization: true }, orderBy: [{ marketplaceId: "asc" }, { resource: "asc" }] });
    if (sources.length !== 8) throw Error("Detail scope changed");
    const manifests = new Map<string, { runId: string; total: number; digest: string }>();
    // Resolve all eight scopes before any enable. No raw object lists in output.
    for (const source of sources) {
      const p = parseObservationPolicy(source.domainPolicy, source.resource);
      assertObservationRoles(p, auth, { ...scope, authorizationId: auth.id, authorizationRevision: auth.revision, marketplaceId: source.marketplaceId });
      const manifest = await prisma.$transaction(tx => discoverProductObjects(tx, scope, source, p));
      if (!manifest) throw Error("Discovery strategy required");
      manifests.set(source.id, { runId: manifest.runId, total: manifest.total, digest: manifest.digest });
      console.log(JSON.stringify({ phase: "manifest-verified", sourceId: source.id, resource: source.resource, marketplaceId: source.marketplaceId, catalogRunId: manifest.runId, total: manifest.total, digest: manifest.digest, batches: Math.ceil(manifest.total / 100) }));
    }
    for (const source of sources) {
      const manifest = manifests.get(source.id)!;
      const active = await prisma.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT", "PAUSED"] } } });
      if (active) { console.log(JSON.stringify({ resource: source.resource, marketplaceId: source.marketplaceId, existingTaskId: active.id })); continue; }
      if (source.activeRunId && source.rowCount === manifest.total) {
        const published = await prisma.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, id: source.activeRunId, resource: source.resource, status: "SUCCEEDED", stage: "COMPLETED", executionVersion: 2, finishedAt: { not: null } }, select: { frozenScope: true } });
        const frozenManifest = (published?.frozenScope as { productManifest?: { runId?: string; total?: number; digest?: string } } | null)?.productManifest;
        const observed = await prisma.amazonDomainObservation.count({ where: { ...scope, sourceId: source.id, sourceRunId: source.activeRunId, kind: source.resource === "catalog_items" ? "CATALOG_DETAIL" : "LISTING_DETAIL" } });
        if (published && frozenManifest?.runId === manifest.runId && frozenManifest.total === manifest.total && frozenManifest.digest === manifest.digest && observed === manifest.total) {
          console.log(JSON.stringify({ resource: source.resource, marketplaceId: source.marketplaceId, alreadyPublished: true, rows: observed }));
          continue;
        }
      }
      if (!source.enabled) await approved({ action: "save-source", revision: source.revision, authorizationId: source.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource: source.resource, enabled: true, freshnessMinutes: source.freshnessMinutes, domainPolicy: source.domainPolicy });
      const raced = await prisma.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"] } } });
      if (raced) { console.log(JSON.stringify({ resource: source.resource, marketplaceId: source.marketplaceId, existingTaskId: raced.id })); continue; }
      const approvalId = await approved({ action: "run", sourceIds: [source.id] });
      const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, executionApprovalId: String(approvalId), sourceId: source.id } });
      console.log(JSON.stringify({ resource: source.resource, marketplaceId: source.marketplaceId, sourceId: source.id, taskId: run.id, status: run.status, approvalId }));
    }
  }
  if (phase === "--status") {
    const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id, resource: { in: ["catalog", "listing_details", "catalog_items"] }, marketplaceId: { in: sites } }, select: { id: true, resource: true, marketplaceId: true, enabled: true, rowCount: true, activeRunId: true, publishedRun: { select: { authorizationRevision: true, status: true } }, runs: { orderBy: { startedAt: "desc" }, take: 1, select: { id: true, status: true, stage: true, pagesCompleted: true, processedCount: true, error: true, nextAttemptAt: true } } }, orderBy: [{ resource: "asc" }, { marketplaceId: "asc" }] });
    console.log(JSON.stringify({ at: new Date().toISOString(), sources, heartbeat: await prisma.workerHeartbeat.findFirst({ where: { queueName: "amazon-data-center-jobs" }, orderBy: { lastSeenAt: "desc" }, select: { status: true, lastSeenAt: true, concurrency: true } }) }));
  }
}
main().catch(error => { console.error(JSON.stringify({ stopped: true, name: error.name, reason: error.name === "SyncInputError" ? error.message : undefined })); process.exitCode = 1; }).finally(() => prisma.$disconnect());
