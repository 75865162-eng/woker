/**
 * P1-2: slow-query / index-hit audit for the four large fact tables.
 *
 * LOCAL EMPTY DATABASE CANNOT VALIDATE INDEX USAGE — EXPLAIN on zero rows always
 * prefers a seq scan. Run this against a staging/production-sized dataset.
 *
 * Usage:
 *   node --import ./scripts/runtime/database-bootstrap.mjs \
 *     node_modules/tsx/dist/cli.mjs scripts/sellfox-slow-query-audit.ts \
 *     --organization-id=ORG --workspace-id=WS [--report-date=YYYY-MM-DD]
 *
 * Read-only: issues EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) only. It prints the
 * plan so a DBA can spot "Seq Scan" / high "Rows Removed by Filter" and decide
 * whether a composite index is warranted. It never creates/drops indexes.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("sellfox-slow-query-audit --organization-id=ORG --workspace-id=WS [--report-date=YYYY-MM-DD]");
    process.exit(0);
  }
  const options = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match) throw new Error(`参数无效: ${arg}`);
    options.set(match[1], match[2]);
  }
  const organizationId = options.get("organization-id");
  const workspaceId = options.get("workspace-id");
  if (!organizationId || !workspaceId) {
    throw new Error("需要 --organization-id 与 --workspace-id。");
  }
  return { organizationId, workspaceId, reportDate: options.get("report-date") ?? null };
}

type Case = { name: string; sql: Prisma.Sql };

async function main() {
  const { organizationId, workspaceId, reportDate } = parseArgs();
  // Match the actual filters used by workbench-read.ts: org+ws scoped, reportDate range,
  // then a secondary msku/asin predicate (the typical search path).
  const dateFilter = reportDate
    ? Prisma.sql`AND "reportDate" = ${reportDate}`
    : Prisma.empty;

  const cases: Case[] = [
    {
      name: "SellfoxSalesDailySnapshot (org/ws/date + msku search)",
      sql: Prisma.sql`SELECT * FROM "SellfoxSalesDailySnapshot"
        WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}
        ${dateFilter} AND msku LIKE 'ABC%'`,
    },
    {
      name: "SellfoxProductDailySnapshot (org/ws/date + asin search)",
      sql: Prisma.sql`SELECT * FROM "SellfoxProductDailySnapshot"
        WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}
        ${dateFilter} AND asin LIKE 'B0%'`,
    },
    {
      name: "SellfoxOrderSnapshot (org/ws/date + status)",
      sql: Prisma.sql`SELECT * FROM "SellfoxOrderSnapshot"
        WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}
        AND "orderStatus" IS NOT NULL`,
    },
    {
      name: "AmazonAdsReportFact (org/ws/profile/date)",
      sql: Prisma.sql`SELECT * FROM "AmazonAdsReportFact"
        WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}
        AND "reportDate" >= CURRENT_DATE - INTERVAL '30 days'`,
    },
  ];

  console.log(JSON.stringify({ scope: "sellfox.slow-query-audit", note: "EMPTY-DB RESULT IS NOT REPRESENTATIVE - run on sized dataset", organizationId, workspaceId, reportDate }));
  for (const item of cases) {
    console.log(`\n### ${item.name}`);
    try {
      const rows = await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>(
        Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${item.sql}`,
      );
      const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      const seqScan = /Seq Scan/.test(plan);
      console.log(plan);
      console.log(`[${seqScan ? "SEQUENTIAL SCAN DETECTED" : "index path used"}]`);
    } catch (error) {
      console.log(`EXPLAIN failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
