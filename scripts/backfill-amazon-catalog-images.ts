import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/db/prisma";
import { createAmazonImageThumbnail, extractAmazonMainImage } from "../src/lib/amazon-sync/catalog-images";
import { getStorageDriver, getStorageType } from "../src/lib/storage";

const scope = { organizationId: "amazon-live-local", workspaceId: "default" };
const authorizationId = "3895911f-89c4-4ebd-8212-dc58bede447e";
const marketplaces = ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8", "A2Q3Y263D00KWC"];
const phase = process.argv[2];
const follow = process.argv.includes("--follow");
const activeTaskStatuses = new Set(["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"]);
const maxDownloadBytes = 15_000_000;
const imageRoot = (organizationId: string, workspaceId: string, contentHash: string) => `assets/amazon-catalog-images/${encodeURIComponent(organizationId)}/${encodeURIComponent(workspaceId)}/${contentHash.slice(0, 2)}/${contentHash}.webp`;

type Candidate = { sellerAccountId: string; marketplaceId: string; asin: string; sourceResource: "catalog_items" | "listing_details"; sourceId: string; sourceRunId: string; sourceUrl: string; capturedAt: Date };
function tuple(candidate: Pick<Candidate, "sellerAccountId" | "marketplaceId" | "asin">) { return JSON.stringify([candidate.sellerAccountId, candidate.marketplaceId, candidate.asin, "MAIN"]); }
function errorCode(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code) return code;
  if (error instanceof Error && /^(?:IMAGE_[A-Z0-9_]+|DETAIL_SOURCE_CHANGED|AUTHORIZATION_CHANGED)$/.test(error.message)) return error.message;
  return error instanceof Error ? error.name : "UNKNOWN";
}

async function imageBuffer(url: string) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Accept: "image/avif,image/webp,image/jpeg,image/png" } });
  if (!response.ok || !response.body) throw new Error(`IMAGE_HTTP_${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]).has(contentType ?? "")) throw new Error("IMAGE_CONTENT_TYPE_INVALID");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxDownloadBytes) throw new Error("IMAGE_TOO_LARGE");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxDownloadBytes) { await reader.cancel(); throw new Error("IMAGE_TOO_LARGE"); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

async function loadCandidates() {
  const allSources = await prisma.amazonSyncDataSource.findMany({
    where: { ...scope, authorizationId, resource: { in: ["catalog_items", "listing_details"] }, marketplaceId: { in: marketplaces } },
    select: { id: true, resource: true, sellerAccountId: true, marketplaceId: true, enabled: true, rowCount: true, activeRunId: true, publishedRun: { select: { status: true, stage: true, executionVersion: true, finishedAt: true, frozenScope: true } }, runs: { orderBy: { startedAt: "desc" }, take: 1, select: { status: true } } },
    orderBy: [{ resource: "asc" }, { marketplaceId: "asc" }], take: 9,
  });
  if (allSources.length !== 8) throw new Error("EXPECTED_EIGHT_DETAIL_SOURCES");
  const sources = allSources.filter(source => source.enabled && source.activeRunId && source.publishedRun?.status === "SUCCEEDED" && source.publishedRun.stage === "COMPLETED" && source.publishedRun.executionVersion === 2 && source.publishedRun.finishedAt);
  if (!sources.length) throw new Error("NO_COMPLETE_PUBLISHED_DETAIL_SOURCE");
  const catalogs = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId, resource: "catalog", enabled: true, marketplaceId: { in: marketplaces } }, select: { id: true, revision: true, activeRunId: true, rowCount: true, sellerAccountId: true, marketplaceId: true, publishedRun: { select: { status: true, executionVersion: true, stage: true, finishedAt: true } } }, take: 5 });
  if (catalogs.length !== 4 || catalogs.some(source => !source.activeRunId || source.publishedRun?.status !== "SUCCEEDED" || source.publishedRun.executionVersion !== 2 || source.publishedRun.stage === "PURGED" || !source.publishedRun.finishedAt)) throw new Error("CURRENT_COMPLETE_CATALOGS_REQUIRED");
  const currentCatalogRows = await prisma.amazonCatalogSnapshot.findMany({ where: { ...scope, OR: catalogs.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, sourceRunId: source.activeRunId! })) }, select: { sellerAccountId: true, marketplaceId: true, asin: true, sellerSku: true }, take: 2001 });
  if (currentCatalogRows.length > 2000) throw new Error("CATALOG_SCOPE_EXCEEDS_REVIEWED_LIMIT");
  const expected = new Set(currentCatalogRows.filter(row => /^[A-Z0-9]{10}$/.test(row.asin)).map(row => JSON.stringify([row.sellerAccountId, row.marketplaceId, row.asin, "MAIN"])));
  for (const source of sources) {
    const manifest = (source.publishedRun?.frozenScope as { productManifest?: { runId?: string; total?: number; authorizationRevision?: number } } | null)?.productManifest;
    const catalog = catalogs.find(candidate => candidate.sellerAccountId === source.sellerAccountId && candidate.marketplaceId === source.marketplaceId);
    const kind = source.resource === "catalog_items" ? "CATALOG_DETAIL" : "LISTING_DETAIL";
    const count = await prisma.amazonDomainObservation.count({ where: { ...scope, sourceId: source.id, sourceRunId: source.activeRunId!, kind } });
    if (!catalog || manifest?.runId !== catalog.activeRunId || manifest.authorizationRevision !== 3 || count !== source.rowCount) throw new Error("DETAIL_SNAPSHOT_DRIFT_OR_INCOMPLETE");
    if (source.resource === "catalog_items" && source.rowCount > 1000) throw new Error("CATALOG_DETAIL_LIMIT_EXCEEDED");
  }
  const observations = await prisma.amazonDomainObservation.findMany({ where: { ...scope, OR: sources.map(source => ({ sourceId: source.id, sourceRunId: source.activeRunId! })), kind: { in: ["CATALOG_DETAIL", "LISTING_DETAIL"] } }, select: { sourceId: true, asin: true, sellerSku: true, facts: true, capturedAt: true }, take: 3000 });
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const candidates = new Map<string, Candidate>();
  const sortedObservations = observations.sort((a, b) => {
    const ar = sourceById.get(a.sourceId)?.resource === "catalog_items" ? 0 : 1;
    const br = sourceById.get(b.sourceId)?.resource === "catalog_items" ? 0 : 1;
    return ar - br;
  });
  for (const observation of sortedObservations) {
    const source = sourceById.get(observation.sourceId);
    if (!source?.activeRunId || !observation.asin || (source.resource !== "catalog_items" && source.resource !== "listing_details")) continue;
    const image = extractAmazonMainImage({ asin: observation.asin, sellerSku: observation.sellerSku, facts: observation.facts }, source.marketplaceId, source.resource);
    if (!image) continue;
    const candidate = { sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, asin: image.asin, sourceResource: source.resource, sourceId: source.id, sourceRunId: source.activeRunId, sourceUrl: image.sourceUrl, capturedAt: observation.capturedAt } satisfies Candidate;
    const key = tuple(candidate);
    if (!expected.has(key)) continue;
    if (!candidates.has(key) || source.resource === "catalog_items") candidates.set(key, candidate);
  }
  const missingKeys = [...expected].filter(key => !candidates.has(key));
  const unpublishedSources = allSources.filter(source => !sources.some(ready => ready.id === source.id)).map(source => ({ resource: source.resource, marketplaceId: source.marketplaceId, latestTaskStatus: source.runs[0]?.status ?? "NOT_STARTED" }));
  const completeSites = new Set(sources.map(source => JSON.stringify([source.sellerAccountId, source.marketplaceId])));
  const pendingMetadata = missingKeys.filter(key => { const [seller, site] = JSON.parse(key) as string[]; return !completeSites.has(JSON.stringify([seller, site])); }).length;
  return { sources, catalogs, expected, candidates: [...candidates.values()], missingKeys, unpublishedSources, pendingMetadata };
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (!(phase === "--preview" || phase === "--apply") || process.env.ERP_RUNTIME_MODE === "production" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local" || getStorageType() !== "local") throw new Error("Reviewed local database and local storage required.");
  const auth = await prisma.amazonSpApiAuthorization.findFirstOrThrow({ where: { ...scope, id: authorizationId, revision: 3, status: "CONFIGURED" }, select: { updatedByUserId: true } });
  if (follow && phase !== "--apply") throw new Error("Follow requires --apply");
  const { sources, expected, candidates, missingKeys, unpublishedSources, pendingMetadata } = await loadCandidates();
  const existing = candidates.length ? await prisma.amazonCatalogImageReference.findMany({ where: { ...scope, OR: candidates.map(candidate => ({ sellerAccountId: candidate.sellerAccountId, marketplaceId: candidate.marketplaceId, asin: candidate.asin, variant: "MAIN" })) }, select: { sellerAccountId: true, marketplaceId: true, asin: true, variant: true, sourceUrl: true, blob: { select: { id: true, contentHash: true, fileId: true, file: { select: { storageKey: true, status: true } } } } }, take: 2000 }) : [];
  const existingByKey = new Map(existing.map(reference => [JSON.stringify([reference.sellerAccountId, reference.marketplaceId, reference.asin, reference.variant]), reference]));
  const byUrl = new Map(existing.filter(reference => reference.blob.file.status === "done").map(reference => [reference.sourceUrl, reference.blob]));
  const pending = candidates.filter(candidate => {
    const reference = existingByKey.get(tuple(candidate));
    return !reference || reference.sourceUrl !== candidate.sourceUrl || reference.blob.file.status !== "done";
  });
  const storedBlobIds = new Set(existing.map(reference => reference.blob.id));
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), phase, readOnly: phase === "--preview", amazonRequests: 0, imageDownloads: 0, storageWrites: 0, marketplaces: sources.map(source => ({ resource: source.resource, marketplaceId: source.marketplaceId, publishedRows: source.rowCount })), unpublishedSources, expectedMarketplaceAsins: expected.size, imageCandidates: candidates.length, missingImageMetadata: missingKeys.length, pendingMetadata, noImageInPublishedSources: missingKeys.length - pendingMetadata, existingReferences: existing.length, existingUniqueBlobs: storedBlobIds.size, pendingReferences: pending.length }) + "\n");
  const waiting = unpublishedSources.some(source => activeTaskStatuses.has(source.latestTaskStatus));
  if (phase === "--preview") return { waiting, allSourcesPublished: unpublishedSources.length === 0 };
  const storage = getStorageDriver();
  const blobByUrl = byUrl;
  let downloaded = 0, stored = 0, linked = 0, failed = 0;
  for (const [index, candidate] of pending.entries()) {
    try {
      let blob = blobByUrl.get(candidate.sourceUrl);
      if (!blob) {
        const source = await imageBuffer(candidate.sourceUrl);
        const thumbnail = await createAmazonImageThumbnail(source);
        downloaded++;
        const contentHash = createHash("sha256").update(thumbnail).digest("hex");
        const existingBlob = await prisma.amazonCatalogImageBlob.findUnique({ where: { organizationId_workspaceId_contentHash: { ...scope, contentHash } }, select: { id: true, contentHash: true, fileId: true, file: { select: { storageKey: true, status: true } } } });
        if (existingBlob) blob = existingBlob;
        else {
          const storageKey = imageRoot(scope.organizationId, scope.workspaceId, contentHash);
          const storedObject = await storage.putBuffer({ key: storageKey, buffer: thumbnail, contentType: "image/webp" });
          try {
            blob = await prisma.amazonCatalogImageBlob.create({ data: {
              id: randomUUID(), ...scope, contentHash, width: 150, height: 150, size: storedObject.size,
              file: { create: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId: auth.updatedByUserId, accountId: candidate.sellerAccountId, marketplace: candidate.marketplaceId, originalName: `${candidate.asin}-main.webp`, mimeType: "image/webp", size: storedObject.size, storageKey: storedObject.key, storageType: "local", status: "done", contentHash } },
            }, select: { id: true, contentHash: true, fileId: true, file: { select: { storageKey: true, status: true } } } });
            stored++;
          } catch (error) {
            if (errorCode(error) !== "P2002") throw error;
            blob = await prisma.amazonCatalogImageBlob.findUniqueOrThrow({ where: { organizationId_workspaceId_contentHash: { ...scope, contentHash } }, select: { id: true, contentHash: true, fileId: true, file: { select: { storageKey: true, status: true } } } });
          }
        }
        blobByUrl.set(candidate.sourceUrl, blob);
      }
      await prisma.$transaction(async tx => {
        const auth = await tx.amazonSpApiAuthorization.findFirst({ where: { ...scope, id: authorizationId, revision: 3, status: "CONFIGURED" }, select: { id: true } });
        if (!auth) throw new Error("AUTHORIZATION_CHANGED");
        const head = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: candidate.sourceId, activeRunId: candidate.sourceRunId, enabled: true }, select: { id: true } });
        if (!head) throw new Error("DETAIL_SOURCE_CHANGED");
        await tx.amazonCatalogImageReference.upsert({
        where: { organizationId_workspaceId_sellerAccountId_marketplaceId_asin_variant: { ...scope, sellerAccountId: candidate.sellerAccountId, marketplaceId: candidate.marketplaceId, asin: candidate.asin, variant: "MAIN" } },
        create: { id: randomUUID(), ...scope, sellerAccountId: candidate.sellerAccountId, marketplaceId: candidate.marketplaceId, asin: candidate.asin, variant: "MAIN", sourceResource: candidate.sourceResource, sourceRunId: candidate.sourceRunId, sourceUrl: candidate.sourceUrl, blobId: blob.id, capturedAt: candidate.capturedAt },
        update: { sourceResource: candidate.sourceResource, sourceRunId: candidate.sourceRunId, sourceUrl: candidate.sourceUrl, blobId: blob.id, capturedAt: candidate.capturedAt },
        });
      });
      linked++;
      if ((index + 1) % 25 === 0 || index + 1 === pending.length) process.stdout.write(JSON.stringify({ processed: index + 1, total: pending.length, downloaded, uniqueFilesCreated: stored, referencesUpserted: linked, failures: failed }) + "\n");
    } catch (error) {
      failed++;
      process.stderr.write(JSON.stringify({ candidateHash: createHash("sha256").update(tuple(candidate)).digest("hex").slice(0, 12), error: errorCode(error) }) + "\n");
    }
  }
  if (failed) process.exitCode = 2;
  else process.stdout.write(JSON.stringify({ downloadComplete: true, allImageMetadataCovered: missingKeys.length === 0, missingImageMetadata: missingKeys.length, downloaded, uniqueFilesCreated: stored, referencesUpserted: linked, deduplicatedReferences: Math.max(0, linked - stored) }) + "\n");
  return { waiting, allSourcesPublished: unpublishedSources.length === 0 };
}

async function run() {
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  for (;;) {
    const result = await main();
    if (!follow || process.exitCode || !result.waiting) {
      if (follow && !result.allSourcesPublished && !process.exitCode) process.exitCode = 3;
      return;
    }
    if (Date.now() >= deadline) {
      process.stdout.write(JSON.stringify({ stopped: true, reason: "PUBLISHED_SOURCE_WAIT_TIMEOUT", resumable: true }) + "\n");
      process.exitCode = 3;
      return;
    }
    await delay(30_000);
  }
}

run().catch(error => { process.stderr.write(JSON.stringify({ stopped: true, code: errorCode(error), noRawIdentifiers: true }) + "\n"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
