import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { applyRuntimeEnvironment } from "./runtime/environment.mjs";

// Existing local configuration only. No sessions, credentials or grants are
// created. PostgreSQL enforces read-only on every service connection.
applyRuntimeEnvironment();
const args = process.argv.slice(2);
const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const authorizationId = option("authorization-id"), actor = option("actor"), output = option("output");
if (!authorizationId || !actor || !output || args.length !== 3) throw Error("Required: --authorization-id=ID --actor=ID --output=PATH");
if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE || process.env.AMAZON_API_EXECUTION_ROLE === "cloud" || process.env.ERP_RUNTIME_MODE === "production") throw Error("Existing local read-only acceptance only");
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw Error("Network is prohibited during local stored-data acceptance"); };
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL,
  options: "-c default_transaction_read_only=on -c statement_timeout=15000" }) });
(globalThis as typeof globalThis & { prisma?: PrismaClient }).prisma = client;
const results: Array<Record<string, unknown>> = [];
const isolation: Array<{ boundary: string; denied: boolean }> = [];
async function main(reportPath: string) {
try {
  const identity = await client.$queryRaw<Array<{ database: string; readOnly: string }>>`SELECT current_database() AS database, current_setting('default_transaction_read_only') AS "readOnly"`;
  if (identity[0]?.readOnly !== "on") throw Error("Read-only database enforcement required");
  const auth = await client.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id: authorizationId }, select: {
    organizationId: true, workspaceId: true, status: true, updatedByUserId: true, identityVerifiedAt: true,
  } });
  if (auth.updatedByUserId !== actor || auth.status !== "CONFIGURED") throw Error("Use the existing configured authorization administrator");
  const scope = { organizationId: auth.organizationId, workspaceId: auth.workspaceId };
  const { listSources } = await import("../src/lib/amazon-sync/read");
  const { querySkillTable, skillDataTables, skillTableAvailability } = await import("../src/lib/amazon-sync/skill-data");
  const bindings = await client.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId, enabled: true },
    select: { sellerAccountId: true, marketplaceId: true }, distinct: ["sellerAccountId", "marketplaceId"] });
  for (const binding of bindings) {
    const sources = (await listSources(scope, binding, actor)).filter(source => source.authorizationId === authorizationId);
    if (!isolation.length && sources.some(source => source.resource === "inventory" && source.activeRunId)) {
      for (const boundary of ["sellerAccountId", "marketplaceId"] as const) {
        let denied = false;
        try { await querySkillTable({ scope, actor, sources, tableName: "inventory", ...binding, [boundary]: randomUUID(), page: 1, pageSize: 50 }); }
        catch (error) { denied = (error as { status?: number }).status === 403; }
        isolation.push({ boundary, denied });
      }
    }
    for (const table of skillDataTables.filter(table => table.resource !== "ads_reports")) {
      if (!sources.some(source => source.resource === table.resource)) continue;
      const base = { ...binding, table: table.name, resource: table.resource };
      const available = skillTableAvailability(sources).find(value => value.name === table.name)?.available;
      if (!available) { results.push({ ...base, status: "UNPUBLISHED", total: null }); continue; }
      const filters: Record<string, string> = table.resource === "brand_analytics" ? { reportKind: "search_terms" } : {};
      try {
        const query = (page: number) => querySkillTable({ scope, actor, sources, tableName: table.name, ...binding, filters, page, pageSize: 50 });
        const first = await query(1), total = first.data.total, lastPage = Math.max(1, Math.ceil(total / 50));
        const last = lastPage === 1 ? first : await query(lastPage);
        if (last.data.total !== total) throw Error("TOTAL_CHANGED_DURING_ACCEPTANCE");
        const expected = total === 0 ? 0 : total - (lastPage - 1) * 50;
        if (last.data.items.length !== expected) throw Error("LAST_PAGE_INCOMPLETE");
        results.push({ ...base, status: "SERVICE_QUERY_VERIFIED", total, firstRows: first.data.items.length, lastPage, lastRows: last.data.items.length,
          evidence: "existing stored data via shared ERP/MCP query service", filters,
          sourceEvidence: sources.filter(source => source.resource === table.resource).map(source => ({ sourceId: source.id, publishedTaskId: source.activeRunId,
            publishedTaskStatus: source.publishedRun?.status ?? null, latestTaskStatus: source.latestTask?.status ?? null,
            lastSuccessAt: source.lastSuccessAt?.toISOString() ?? null })), zeroRowsProveNoData: false });
      } catch (error) {
        const known = error as { code?: string; businessCode?: string; status?: number; message?: string };
        results.push({ ...base, status: "QUERY_FAILED", code: known.businessCode ?? known.code ?? "SERVICE_QUERY_FAILED", httpStatus: known.status ?? null });
      }
    }
  }
  const report = { observedAt: new Date().toISOString(), environment: "existing local database", database: identity[0].database,
    databaseReadOnly: true, authorizationId, identityVerified: !!auth.identityVerifiedAt, actorBasis: "existing authorization administrator; current service permissions enforced",
    scope: "stored data query service only; no HTTP ERP endpoint, MCP protocol or native Skill acceptance", networkAttempts,
    realAmazonRequests: 0, workerStarted: false, sourceBindings: bindings.length, isolation, results };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output: reportPath, cases: results.length, verified: results.filter(row => row.status === "SERVICE_QUERY_VERIFIED").length,
    unpublished: results.filter(row => row.status === "UNPUBLISHED").length, failures: results.filter(row => row.status === "QUERY_FAILED").length, networkAttempts }));
  if (networkAttempts || isolation.length !== 2 || isolation.some(check => !check.denied) || results.some(row => row.status === "QUERY_FAILED")) process.exitCode = 2;
} finally { await client.$disconnect(); }
}
main(output).catch(error => { console.error(JSON.stringify({ status: "LOCAL_READ_ACCEPTANCE_FAILED", code: (error as { code?: string }).code ?? "READ_FAILED" })); process.exitCode = 1; });
