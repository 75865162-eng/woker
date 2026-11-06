import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Aggregate-only local inspection: no dotenv, credential decryption, HTTP or writes.
const connectionString = process.env.DATABASE_URL;
const target = new URL(connectionString ?? "invalid:");
if (process.argv[2] !== "--report-only" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.port !== "55439" || target.pathname !== "/amazon_sync_live_local") throw new Error("Reviewed local database and --report-only required.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const scope = { organizationId: "amazon-live-local", workspaceId: "default" };

async function main() {
  try {
    const report = await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
      const auths = await tx.amazonSpApiAuthorization.findMany({ where: scope, select: { id: true, name: true, revision: true, status: true, amazonSellerId: true, approvedRoles: true, rolesAttestedAt: true } });
      const sources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, resource: { in: ["catalog", "listing_details", "catalog_items"] } }, select: { id: true, authorizationId: true, sellerAccountId: true, marketplaceId: true, resource: true, revision: true, enabled: true, activeRunId: true, lastSuccessAt: true, rowCount: true, coverage: true, domainPolicy: true, publishedRun: { select: { status: true, executionVersion: true, stage: true, finishedAt: true, frozenScope: true } } }, take: 201 });
      if (sources.length > 200) throw new Error("Capacity exceeded");
      const catalogs = [];
      for (const source of sources.filter(s => s.resource === "catalog")) {
        const frozen = source.publishedRun?.frozenScope as Record<string, unknown> | undefined;
        const auth = auths.find(a => a.id === source.authorizationId);
        const counts = source.activeRunId ? await tx.$queryRaw<Array<{ rows: number; skus: number; asins: number; invalidSkus: number; invalidAsins: number }>>`
          SELECT COUNT(*)::int AS rows, COUNT(DISTINCT "sellerSku")::int AS skus,
            COUNT(DISTINCT "asin") FILTER (WHERE "asin" ~ '^[A-Z0-9]{10}$')::int AS asins,
            COUNT(*) FILTER (WHERE length("sellerSku") NOT BETWEEN 1 AND 255 OR "sellerSku" ~ '[[:cntrl:]]')::int AS "invalidSkus",
            COUNT(*) FILTER (WHERE "asin" !~ '^[A-Z0-9]{10}$')::int AS "invalidAsins"
          FROM "AmazonCatalogSnapshot" WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
            AND "sellerAccountId" = ${source.sellerAccountId} AND "marketplaceId" = ${source.marketplaceId} AND "sourceRunId" = ${source.activeRunId}
        ` : [];
        const coverage = source.coverage as Record<string, unknown> | null;
        catalogs.push({ sourceId: source.id, authorizationId: source.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, activeRunId: source.activeRunId, lastSuccessAt: source.lastSuccessAt, rowCount: source.rowCount, coverage: coverage ? { type: coverage.type, paginationComplete: coverage.paginationComplete, rowCount: coverage.rowCount } : null, run: source.publishedRun ? { status: source.publishedRun.status, executionVersion: source.publishedRun.executionVersion, stage: source.publishedRun.stage, finishedAt: source.publishedRun.finishedAt, frozenAuthorizationRevision: frozen?.authorizationRevision, matchesCurrentSeller: !!auth?.amazonSellerId && frozen?.amazonSellerId === auth.amazonSellerId } : null, counts: counts[0] ?? null });
      }
      return { checkedAt: new Date().toISOString(), readOnly: true, amazonHttp: false, scope,
        authorizations: auths.map(({ amazonSellerId, ...a }) => ({ ...a, sellerIdentityKnown: !!amazonSellerId })), catalogs,
        details: sources.filter(s => s.resource !== "catalog").map(s => ({ id: s.id, resource: s.resource, marketplaceId: s.marketplaceId, revision: s.revision, enabled: s.enabled, hasPolicy: !!s.domainPolicy, activeRunId: s.activeRunId, rowCount: s.rowCount })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (error) { process.stderr.write(JSON.stringify({ failed: true, name: error instanceof Error ? error.name : "Unknown", code: (error as { code?: string }).code ?? null, noDataChanged: true }) + "\n"); process.exitCode = 1; }
  finally { await db.$disconnect(); }
}
void main();
