import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { decryptCheckpoint } from "../src/lib/amazon-sync/checkpoint";
import { assertFinanceRequestWindow, previewFinanceRetentionRecovery } from "../src/lib/amazon-sync/finance";

// Explicit existing local target only. No dotenv, writes, Amazon HTTP or jobs.
const connectionString = process.env.DATABASE_URL;
const target = new URL(connectionString ?? "invalid:");
if (process.argv[2] !== "--report-only" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.port !== "55439" || target.pathname !== "/amazon_sync_live_local") throw new Error("Reviewed local database and --report-only required.");
const scope = { organizationId: "amazon-live-local", workspaceId: "default" };
const resources = ["finance", "inventory_events", "reimbursements", "settlements"];
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
async function main() {
  try {
    const report = await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
      const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, resource: { in: resources } }, select: { id: true, resource: true, sellerAccountId: true, marketplaceId: true, authorizationId: true, revision: true, lastSuccessAt: true, rowCount: true, resourceCursor: true, authorization: { select: { revision: true, amazonSellerId: true, status: true } } }, take: 201 });
      const runs = await tx.amazonSyncRun.findMany({ where: { ...scope, resource: { in: resources } }, select: { id: true, sourceId: true, resource: true, status: true, stage: true, frozenScope: true, pagesCompleted: true, processedCount: true, checkpointCiphertext: true, leaseExpiresAt: true }, orderBy: { id: "asc" }, take: 1001 });
      if (sources.length > 200 || runs.length > 1000) throw new Error("Preflight bounded capacity exceeded");
      const instant = new Date();
      return { checkedAt: instant.toISOString(), scope, readOnly: true, amazonHttp: false, truncated: false,
        sources: await Promise.all(sources.map(async source => {
          const cursor = source.resourceCursor;
          let state: Record<string, unknown> = {};
          if (cursor?.reportStateCiphertext) state = JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? "{}");
          let financeRecovery = null;
          if (source.resource === "finance" && cursor) {
            const window = { from: cursor.watermarkFrom.toISOString(), to: cursor.watermarkTo.toISOString() };
            const sourceRuns = runs.filter(run => run.sourceId === source.id);
            const records = await tx.amazonFinanceRecord.count({ where: { ...scope, sourceId: source.id } });
            const pages = await tx.amazonSyncRawPage.count({ where: { ...scope, taskId: { in: sourceRuns.map(run => run.id) } } });
            try { assertFinanceRequestWindow(window, instant); } catch {
              financeRecovery = previewFinanceRetentionRecovery(window, instant, { hasNextToken: !!cursor.nextTokenCiphertext, pages: Math.max(pages, ...sourceRuns.map(run => run.pagesCompleted), 0), records, hasCheckpoint: !!cursor.reportStateCiphertext || sourceRuns.some(run => !!run.checkpointCiphertext) });
            }
          }
          return { id: source.id, resource: source.resource, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, authorizationId: source.authorizationId, revision: source.revision, authorizationRevision: source.authorization.revision, sellerIdentityKnown: !!source.authorization.amazonSellerId, authorizationStatus: source.authorization.status, lastSuccessAt: source.lastSuccessAt, rowCount: source.rowCount,
            cursor: cursor ? { id: cursor.id, status: cursor.status, activeRunId: cursor.activeRunId, from: cursor.watermarkFrom, to: cursor.watermarkTo, pages: runs.filter(run => run.sourceId === source.id).reduce((n, run) => n + run.pagesCompleted, 0), hasPageToken: !!cursor.nextTokenCiphertext, hasReportState: !!cursor.reportStateCiphertext, reportId: typeof state.reportId === "string" ? state.reportId : null, creating: state.creating === true, hasArchive: !!state.archiveTaskId, hasDiscoveryToken: !!state.discoveryToken } : null, financeRecovery };
        })),
        runs: runs.map(run => { const frozen = run.frozenScope as Record<string, unknown>; return { ...run, frozenScope: undefined, checkpointCiphertext: undefined, hasCheckpoint: !!run.checkpointCiphertext, reportWindow: frozen.reportWindow ?? null, financeWindow: frozen.financeWindow ?? null, authorizationRevision: frozen.authorizationRevision, sellerIdentityKnown: !!frozen.amazonSellerId }; }),
        documents: await tx.amazonSyncReportDocument.groupBy({ by: ["resource", "status"], where: { ...scope, resource: { in: resources } }, _count: true }),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (error) { process.stderr.write(JSON.stringify({ failed: true, name: error instanceof Error ? error.name : "Unknown", code: (error as { code?: string }).code ?? null, noDataChanged: true }) + "\n"); process.exitCode = 1; }
  finally { await db.$disconnect(); }
}
void main();
