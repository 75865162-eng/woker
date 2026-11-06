import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { preflightIdentityRecovery } from "../src/lib/amazon-sync/identity-recovery";
// No dotenv loading and no apply mode. Explicit local target only.
const args = process.argv.slice(2);
const keys = ["--organization-id=", "--workspace-id=", "--authorization-id=", "--seller-id="];
if (args.length !== 5 || args[0] !== "--report-only" || keys.some((key, i) => !args[i + 1]?.startsWith(key) || !args[i + 1].slice(key.length))) throw new Error("Usage: --report-only --organization-id=<id> --workspace-id=<id> --authorization-id=<id> --seller-id=<id>");
const connectionString = process.env.DATABASE_URL;
const target = new URL(connectionString ?? "invalid:");
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.port !== "55439" || target.pathname !== "/amazon_sync_live_local") throw new Error("Only the reviewed local recovery database is allowed.");
const values = keys.map((key, i) => args[i + 1].slice(key.length));
if (values[0] !== "amazon-live-local" || values[1] !== "default") throw new Error("Only the reviewed local scope is allowed.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
async function main() {
  try {
    const report = await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
      return preflightIdentityRecovery(tx, { organizationId: values[0], workspaceId: values[1] }, values[2], values[3]);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.blockers.length) process.exitCode = 2;
  } catch { process.stderr.write("Read-only identity preflight failed; no data changed. Details omitted.\n"); process.exitCode = 1; }
  finally { await db.$disconnect(); }
}
void main();
