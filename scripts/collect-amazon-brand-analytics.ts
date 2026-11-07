// Controlled local execution through existing audited approvals. Never print credentials or ASIN lists.
import assert from "node:assert/strict";
import { readBrandAnalytics, readBrandAsinAnalysis } from "../src/lib/amazon-sync/brand-analytics-query";
import { prisma } from "../src/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "../src/lib/amazon-sync/change-approval";
import { discoverProductObjects } from "../src/lib/amazon-sync/product-discovery";
import { brandCollectionWindows, type BrandCollection } from "../src/lib/amazon-sync/brand-collection";
import { brandReports } from "../src/lib/amazon-sync/brand-reports";
import { reportTimeZone } from "../src/lib/amazon-sync/date-range";
import { digest, unseal } from "../src/lib/amazon-sync/approval-policy";
import { parseObservationReport } from "../src/lib/amazon-sync/observation-parsers";
import { parseObservationPolicy } from "../src/lib/amazon-sync/observation-policy";
import { readBrandCollection } from "../src/lib/amazon-sync/brand-collection-query";
const scope = { organizationId: "amazon-live-local", workspaceId: "default" };
const sites = ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8", "A2Q3Y263D00KWC"];
const phase = process.argv[2];
const url = new URL(process.env.DATABASE_URL ?? "invalid:");
if (!["--preview", "--apply", "--status", "--next", "--enable-plan", "--retry-downloaded", "--retry-sqp-downloaded", "--retry-mx-sqp-downloaded", "--retry-ca-catalog-downloaded", "--verify-published", "--verify-recovered", "--retry-verified-sqp", "--retry-br-searchterms"].includes(phase) || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local") throw Error("Reviewed local target required");
async function main() {
  const auth = await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: "3895911f-89c4-4ebd-8212-dc58bede447e" } });
  if (auth.organizationId !== scope.organizationId || auth.workspaceId !== scope.workspaceId || auth.revision !== 3 || auth.status !== "CONFIGURED") throw Error("Authorization changed");
  if (phase === "--verify-recovered") {
    const targets = [
      { site: "BR", id: "4f85f662-0f02-41ee-a780-35bf20429c46", marketplaceId: "A2Q3Y263D00KWC", kind: "search_query", rows: 2 },
      { site: "MX", id: "699d009f-9676-454b-a84e-1a9af05d75ff", marketplaceId: "A1AM78C64UM0Y8", kind: "search_query", rows: 9 },
      { site: "CA", id: "4521f0f2-96cd-48e2-afe1-e1768e825da0", marketplaceId: "A2EUQ1WTGCTBG2", kind: "search_catalog", rows: 14 },
      { site: "CA-SQP", id: "cc38ed70-de07-4f88-b9cf-e9eaa7115ae1", marketplaceId: "A2EUQ1WTGCTBG2", kind: "search_query", rows: 94 },
      { site: "US-SQP", id: "a5235d75-21bf-40c3-ba36-6f4c5116586a", marketplaceId: "ATVPDKIKX0DER", kind: "search_query", rows: 123 },
      { site: "MX-SQP", id: "f6dd4b17-83e0-452b-b0c5-830d477a8d92", marketplaceId: "A1AM78C64UM0Y8", kind: "search_query", rows: 3 },
    ];
    for (const target of targets) {
      const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: target.id, authorizationRevision: 3, resource: "brand_analytics" }, include: { source: true } });
      assert.ok(run.source);
      assert.ok(run.sourceId);
      assert.equal(run.source.authorizationId, auth.id);
      assert.equal(run.source.marketplaceId, target.marketplaceId);
      const policy = parseObservationPolicy((run.frozenScope as { domainPolicy?: unknown }).domainPolicy, "brand_analytics");
      assert.ok(policy.resource === "brand_analytics");
      assert.equal(policy.reportKind, target.kind);
      assert.equal(policy.reportPeriod, "WEEK");
      assert.equal(policy.from, "2026-10-25"); assert.equal(policy.to, "2026-10-31");
      assert.equal(policy.maxRequests, 30); assert.equal(policy.maxRows, 10000); assert.equal(policy.requestsPerSecond, .01);
      if (run.status !== "SUCCEEDED") {
        console.log(JSON.stringify({ site: target.site, recoveredAcceptancePassed: false, status: run.status, apiRequests: run.apiRequests }));
        process.exitCode = 2; continue;
      }
      const pages = await prisma.amazonSyncRawPage.findMany({ where: { ...scope, taskId: run.id }, orderBy: { page: "asc" } });
      const operation = (page: typeof pages[number]) => (page.requestMetadata as { operation?: string }).operation;
      const creates = pages.filter(page => operation(page) === "createReport");
      assert.equal(creates.length, 1, "Original report must not be recreated");
      const decode = (page: typeof pages[number]) => {
        const raw = unseal(page.rawCiphertext, scope, `${run.id}:${page.page}`, "amazon-observation-raw.v1").rawBody;
        assert.equal(typeof raw, "string");
        assert.equal(digest(raw), page.bodySha256, "Archived response digest mismatch");
        return raw as string;
      };
      const originalReportId = (JSON.parse(decode(creates[0])) as { reportId?: string }).reportId;
      assert.ok(originalReportId);
      assert.equal((run.summary as { coverage?: { reportId?: string } }).coverage?.reportId, originalReportId);
      const download = pages.findLast(page => operation(page) === "downloadReportDocument"); assert.ok(download);
      const parsed = parseObservationReport(decode(download), policy, target.marketplaceId);
      const saved = await prisma.amazonDomainObservation.findMany({ where: { ...scope, sourceId: run.sourceId, sourceRunId: run.id } });
      assert.equal(parsed.length, target.rows); assert.equal(saved.length, target.rows); assert.equal(run.processedCount, target.rows);
      const byKey = new Map(saved.map(row => [`${row.kind}:${row.businessKey}`, row]));
      for (const fact of parsed) {
        const row = byKey.get(`${fact.kind}:${fact.businessKey}`); assert.ok(row, "Published business key mismatch");
        // Compare hashes so assertion errors cannot print private report facts.
        assert.equal(digest(row.facts), digest(fact.facts), "Published facts differ from original report");
      }
      console.log(JSON.stringify({ site: target.site, recoveredAcceptancePassed: true, rows: saved.length, originalReportPreserved: true, createReportCount: creates.length, apiRequests: run.apiRequests }));
    }
    return;
  }
  async function approved(command: Record<string, unknown>) {
    const request = await requestChange(scope, auth.updatedByUserId, command);
    await decideChange(scope, auth.updatedByUserId, String(request.id), "APPROVED", (phase === "--retry-ca-catalog-downloaded" ? "用户批准仅兼容SCP展示价格对象空值，并恢复加拿大原任务4521f0f2-96cd-48e2-afe1-e1768e825da0的DOWNLOAD检查点；不重建报告、不重置请求预算。" : phase === "--retry-mx-sqp-downloaded" ? "用户批准仅恢复墨西哥原SQP任务699d009f-9676-454b-a84e-1a9af05d75ff的DOWNLOAD检查点；同报告、同预算、无重载、无替代报告、无计数重置。" : phase === "--retry-sqp-downloaded" ? "用户批准SQP六项空值与原始单位兼容修复后，仅恢复巴西原任务4f85f662-0f02-41ee-a780-35bf20429c46的DOWNLOAD检查点；不创建替代报告，不重置计数。" : "用户批准本机四站品牌分析真实同步验收：2026-10-25 至 2026-10-31，五类周报、当前商品快照全部候选 ASIN、每任务最多30请求/10000行，账号设置统一权限，不修改凭据。"));
    await applyChange(scope, auth.updatedByUserId, String(request.id));
  }
  if (phase === "--retry-br-searchterms") {
    const id = "b0dcd1f9-4241-49c0-a4fb-381f98334384";
    const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id, resource: "brand_analytics", authorizationRevision: 3 }, include: { source: true } });
    assert.ok(run.source?.authorizationId === auth.id && run.source.marketplaceId === "A2Q3Y263D00KWC");
    const policy = parseObservationPolicy((run.frozenScope as { domainPolicy?: unknown }).domainPolicy, "brand_analytics");
    assert.ok(policy.resource === "brand_analytics" && policy.reportKind === "search_terms");
    assert.equal(policy.from, "2026-10-25"); assert.equal(policy.to, "2026-10-31");
    assert.equal(policy.maxRequests, 30); assert.equal(policy.requestsPerSecond, .01);
    if (run.status !== "FAILED") { console.log(JSON.stringify({ id, status: run.status, skippedExistingRecovery: true })); return; }
    const state = unseal(run.checkpointCiphertext!, scope, id, "amazon-observation-state.v1").state as { stage?: string; reportId?: string; requests?: number };
    assert.ok(state.stage === "DOWNLOAD" && state.reportId && Number.isSafeInteger(state.requests) && state.requests! > 0 && state.requests! < policy.maxRequests);
    await approved({ action: "control-task", id, control: "retry" });
    console.log(JSON.stringify({ id, resumedOriginalReport: true, preservedBudget: true })); return;
  }
  if (phase === "--retry-verified-sqp") {
    for (const id of ["cc38ed70-de07-4f88-b9cf-e9eaa7115ae1", "a5235d75-21bf-40c3-ba36-6f4c5116586a", "f6dd4b17-83e0-452b-b0c5-830d477a8d92"]) {
      const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id, resource: "brand_analytics", authorizationRevision: 3 }, include: { source: true } });
      assert.ok(run.source && sites.includes(run.source.marketplaceId) && run.source.authorizationId === auth.id);
      const policy = parseObservationPolicy((run.frozenScope as { domainPolicy?: unknown }).domainPolicy, "brand_analytics");
      assert.ok(policy.resource === "brand_analytics" && policy.reportKind === "search_query" && policy.reportPeriod === "WEEK");
      assert.equal(policy.from, "2026-10-25"); assert.equal(policy.to, "2026-10-31");
      assert.equal(policy.maxRequests, 30); assert.equal(policy.maxRows, 10000); assert.equal(policy.requestsPerSecond, .01);
      if (run.status !== "FAILED") { console.log(JSON.stringify({ id, status: run.status, skippedExistingRecovery: true })); continue; }
      const state = unseal(run.checkpointCiphertext!, scope, id, "amazon-observation-state.v1").state as { stage?: string; reportId?: string; requests?: number };
      assert.ok(state.stage === "DOWNLOAD" && state.reportId && Number.isSafeInteger(state.requests) && state.requests! > 0 && state.requests! < policy.maxRequests);
      const page = await prisma.amazonSyncRawPage.findFirstOrThrow({ where: { ...scope, taskId: id, requestMetadata: { path: ["operation"], equals: "downloadReportDocument" } }, orderBy: { page: "desc" } });
      const raw = unseal(page.rawCiphertext, scope, `${id}:${page.page}`, "amazon-observation-raw.v1").rawBody;
      assert.equal(typeof raw, "string"); assert.equal(digest(raw), page.bodySha256);
      const rows = parseObservationReport(raw as string, policy, run.source.marketplaceId);
      await approved({ action: "control-task", id, control: "retry" });
      console.log(JSON.stringify({ id, resumedOriginalReport: true, verifiedRows: rows.length }));
    }
    return;
  }
  if (phase === "--status" || phase === "--next" || phase === "--enable-plan" || phase === "--retry-downloaded" || phase === "--retry-sqp-downloaded" || phase === "--retry-mx-sqp-downloaded" || phase === "--retry-ca-catalog-downloaded" || phase === "--verify-published") {
    const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: auth.id, resource: "brand_analytics", marketplaceId: { in: sites } }, include: { authorization: { select: { revision: true } } } });
    if (phase === "--verify-published" || phase === "--retry-sqp-downloaded" || phase === "--retry-mx-sqp-downloaded" || phase === "--retry-ca-catalog-downloaded") assert.equal(sources.length, 4, "Reviewed four-marketplace scope required");
    for (const source of sources) {
      const coverage = await readBrandCollection(prisma, scope, source);
      if (phase === "--verify-published") {
        assert.ok(coverage, "Approved finite collection required");
        assert.equal(coverage.policy.collection?.from, "2026-10-25");
        assert.equal(coverage.policy.collection?.to, "2026-10-31");
        const results = [];
        const checks: Array<() => void> = [];
        let sampleAsin: string | null = null;
        for (const kind of Object.keys(brandReports)) {
          const items = coverage.items.filter(item => item.reportKind === kind);
          assert.ok(items.every(item => item.reportPeriod === "WEEK"), "Reviewed weekly collection required");
          const published = items.filter(item => ["SUCCEEDED", "EMPTY"].includes(item.status));
          const expectedRows = published.reduce((sum, item) => sum + (item.rows ?? 0), 0);
          const params = new URLSearchParams({ sourceId: source.id, reportKind: kind, reportPeriod: "WEEK", from: "2026-10-25", to: "2026-10-31" });
          const report = await readBrandAnalytics(scope, params, auth.updatedByUserId);
          checks.push(() => assert.equal(report.source?.id, source.id, "Report source mismatch"));
          checks.push(() => assert.equal(report.pagination.total, expectedRows, "Published task rows and receiver query disagree"));
          checks.push(() => assert.equal(report.batchCount, published.length, "Published batches and receiver query disagree"));
          checks.push(() => assert.ok(report.rows.every(row => published.some(item => item.taskId === row.sourceRunId)), "Unpublished or foreign rows reached receiver"));
          sampleAsin ??= report.rows.find(row => row.asin)?.asin ?? null;
          results.push({ kind, publishedBatches: published.length, expectedRows, queryRows: report.pagination.total, emptyReports: published.filter(item => item.status === "EMPTY").length });
        }
        let asinVerified = false;
        if (sampleAsin) {
          const params = new URLSearchParams({ sourceId: source.id, asin: sampleAsin, reportPeriod: "WEEK", from: "2026-10-25", to: "2026-10-31" });
          const analysis = await readBrandAsinAnalysis(scope, params, auth.updatedByUserId);
          checks.push(() => assert.equal(analysis.source?.id, source.id, "ASIN source mismatch"));
          checks.push(() => assert.equal(analysis.reports.length, Object.keys(brandReports).length));
          for (const report of analysis.reports) {
            const p = new URLSearchParams(params); p.set("reportKind", report.reportKind);
            const filtered = await readBrandAnalytics(scope, p, auth.updatedByUserId);
            checks.push(() => assert.equal(report.result?.pagination.total, filtered.pagination.total, "ASIN analysis and filtered receiver disagree"));
            checks.push(() => assert.ok(report.result?.rows.every(row => row.asin === sampleAsin), "ASIN analysis returned a different ASIN"));
          }
          asinVerified = true;
        }
        const after = await readBrandCollection(prisma, scope, source);
        const signature = (value: typeof coverage) => JSON.stringify(value.items.map(item => [item.key, item.taskId, item.status, item.rows]));
        if (!after || signature(after) !== signature(coverage)) {
          // Query services use their normal scoped reads. Never claim a stable
          // acceptance result if a worker published another batch during them.
          console.log(JSON.stringify({ marketplaceId: source.marketplaceId, publishedAcceptancePassed: false, deferred: true, reason: "Collection changed during read; rerun acceptance." }));
          process.exitCode = 2;
          continue;
        }
        for (const check of checks) check();
        console.log(JSON.stringify({ marketplaceId: source.marketplaceId, completed: coverage.completed, total: coverage.total, complete: coverage.complete, publishedAcceptancePassed: true, asinVerified, reports: results }));
        continue;
      }
      const recent = await prisma.amazonSyncRun.findMany({ where: { ...scope, sourceId: source.id }, select: { id: true, status: true, stage: true, error: true, apiRequests: true, processedCount: true, nextAttemptAt: true }, orderBy: { startedAt: "desc" }, take: 1 });
      const reports = Object.keys(brandReports).map(kind => {
        const items = coverage?.items.filter(item => item.reportKind === kind) ?? [];
        const published = items.filter(item => ["SUCCEEDED", "EMPTY"].includes(item.status));
        return { kind, completed: published.length, total: items.length, empty: published.filter(item => item.status === "EMPTY").length, publishedRows: published.reduce((sum, item) => sum + (item.rows ?? 0), 0) };
      });
      console.log(JSON.stringify({ marketplaceId: source.marketplaceId, sourceId: source.id, completed: coverage?.completed, total: coverage?.total, reports, next: coverage?.next ? { kind: coverage.next.reportKind, status: coverage.next.status, taskId: coverage.next.taskId } : null, recent }));
      if (phase === "--retry-sqp-downloaded" && source.marketplaceId === "A2Q3Y263D00KWC" || phase === "--retry-mx-sqp-downloaded" && source.marketplaceId === "A1AM78C64UM0Y8") {
        const taskId = phase === "--retry-mx-sqp-downloaded" ? "699d009f-9676-454b-a84e-1a9af05d75ff" : "4f85f662-0f02-41ee-a780-35bf20429c46";
        if (coverage?.next?.status !== "FAILED" || coverage.next.taskId !== taskId) throw Error("Reviewed failed SQP checkpoint changed");
        const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: taskId, sourceId: source.id, status: "FAILED", authorizationRevision: 3 } });
        const state = unseal(run.checkpointCiphertext!, scope, run.id, "amazon-observation-state.v1").state as { stage?: string; reportId?: string; requests?: number };
        const policy = (run.frozenScope as { domainPolicy?: { from?: string; to?: string; reportKind?: string; maxRequests?: number; maxRows?: number; requestsPerSecond?: number } }).domainPolicy;
        if (state.stage !== "DOWNLOAD" || !state.reportId || !Number.isSafeInteger(state.requests) || state.requests! < 1 || state.requests! >= 30 || policy?.from !== "2026-10-25" || policy.to !== "2026-10-31" || policy.reportKind !== "search_query" || policy.maxRequests !== 30 || policy.maxRows !== 10000 || policy.requestsPerSecond !== .01) throw Error("Only the reviewed original SQP report checkpoint can resume");
        await approved({ action: "control-task", id: run.id, control: "retry" });
        console.log(JSON.stringify({ marketplaceId: source.marketplaceId, taskId: run.id, resumedExistingSqpDownload: true }));
      }
      if (phase === "--retry-ca-catalog-downloaded" && source.marketplaceId === "A2EUQ1WTGCTBG2") {
        const taskId = "4521f0f2-96cd-48e2-afe1-e1768e825da0";
        if (coverage?.next?.status !== "FAILED" || coverage.next.taskId !== taskId) throw Error("Reviewed failed CA catalog checkpoint changed");
        const run = await prisma.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: taskId, sourceId: source.id, status: "FAILED", authorizationRevision: 3 } });
        const state = unseal(run.checkpointCiphertext!, scope, run.id, "amazon-observation-state.v1").state as { stage?: string; reportId?: string; requests?: number };
        const policy = (run.frozenScope as { domainPolicy?: { from?: string; to?: string; reportKind?: string; reportPeriod?: string; maxRequests?: number; maxRows?: number; requestsPerSecond?: number } }).domainPolicy;
        if (state.stage !== "DOWNLOAD" || !state.reportId || !Number.isSafeInteger(state.requests) || state.requests! < 1 || state.requests! >= 30 || policy?.from !== "2026-10-25" || policy.to !== "2026-10-31" || policy.reportKind !== "search_catalog" || policy.reportPeriod !== "WEEK" || policy.maxRequests !== 30 || policy.maxRows !== 10000 || policy.requestsPerSecond !== .01) throw Error("Only reviewed CA original catalog report can resume");
        await approved({ action: "control-task", id: run.id, control: "retry" });
        console.log(JSON.stringify({ marketplaceId: source.marketplaceId, taskId: run.id, resumedExistingCaCatalogDownload: true }));
      }
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
main().catch(error => { console.error(JSON.stringify({ stopped: true, name: error.name, reason: error.name === "SyncInputError" ? error.message : error.name === "AssertionError" ? "Published report acceptance mismatch; inspect scoped checkpoints before continuing." : undefined })); process.exitCode = 1; }).finally(() => prisma.$disconnect());
