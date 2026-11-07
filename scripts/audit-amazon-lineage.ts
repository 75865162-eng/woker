import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { auditAmazonLineage } from "../src/lib/amazon-sync/lineage-audit";
// Deliberately does not load .env. Target connection must be supplied by the operator
// after target-specific approval. This script NEVER performs a data migration.
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== "--report-only" || !args[1].startsWith("--organization-id=") || !args[2].startsWith("--workspace-id=")) throw new Error("Usage: tsx scripts/audit-amazon-lineage.ts --report-only --organization-id=<id> --workspace-id=<id>");
const scope = { organizationId: args[1].slice(18), workspaceId: args[2].slice(15) };
if (!scope.organizationId || !scope.workspaceId || !process.env.DATABASE_URL) throw new Error("Explicit scope and target DATABASE_URL required");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function main() {
try {
  const report = await db.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`; return auditAmazonLineage(tx, scope); }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.truncated || report.pendingReview.length || report.conflictingSourceBindings) process.exitCode = 2;
} catch { process.stderr.write("Read-only lineage audit failed; no data changed. Target details omitted.\n"); process.exitCode = 1; }
finally { await db.$disconnect(); }
}
void main();
