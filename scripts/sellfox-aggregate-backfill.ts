// 赛狐预聚合表历史回填 CLI（派生写入，幂等，可重复执行）。
//
// 背景：SELLFOX_AGG_READ_ENABLED 默认关闭，post-sync-projections 不会写聚合表，
// 因此克隆/新环境里 SalesAggDaily/ProfitAggDaily/AdsAggDaily/OverviewAgg 全为空。
// 本脚本用 agg-refresh.ts 的纯 SQL 函数，从已有源快照一次性回填历史数据，使
// 「数据就绪」。写入是 INSERT ... ON CONFLICT DO UPDATE 的派生结果，不改变任何
// 业务事实，也不改任何页面读路径（页面仍读实时源）；切读由对账门禁单独决定。
//
// 用法：
//   ... sellfox-aggregate-backfill.ts --organization-id=ID --workspace-id=ID
//        [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--apply]
//   默认 dry-run 只盘点源表行数与日期窗；--apply 才真正回填。
import { prisma } from "@/lib/db/prisma";
import {
  salesAggDailyStatement, profitAggDailyStatement, adsAggDailyStatement,
  overviewAggStatement, type AggRefreshInput,
} from "@/lib/sellfox/agg-refresh";
import { sellfoxDateAt } from "@/lib/sellfox/sync-contract";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "sellfox-aggregate-backfill --organization-id=ID --workspace-id=ID " +
      "[--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--apply]\n" +
      "从源快照回填四张预聚合表（sales/profit/ads/overview）。默认 dry-run；--apply 才写入。" +
      "幂等可重复执行。写入为派生结果，不改业务事实、不改页面读路径。",
    );
    return;
  }
  const allowed = new Set(["organization-id", "workspace-id", "from", "to"]);
  const options = new Map<string, string>();
  for (const arg of args) {
    if (arg === "--apply") continue;
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || options.has(match[1])) {
      throw new Error("参数无效或重复，请使用 --help。");
    }
    options.set(match[1], match[2]);
  }
  const organizationId = options.get("organization-id");
  const workspaceId = options.get("workspace-id");
  if (!organizationId || !workspaceId) throw new Error("必须显式指定 --organization-id 与 --workspace-id。");
  const to = options.get("to") ?? sellfoxDateAt(new Date(), 0);
  const from = options.get("from") ?? "1970-01-01";

  // 盘点源数据（只读），让操作者在 apply 前看到确切的日期窗与规模。
  const [sales, profit, ads] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint; d0: string | null; d1: string | null }>>`
      SELECT count(*)::bigint AS n, min("reportDate")::text AS d0, max("reportDate")::text AS d1
      FROM "SellfoxSalesDailySnapshot"
      WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}
        AND "reportDate" BETWEEN ${from} AND ${to}`,
    prisma.$queryRaw<Array<{ n: bigint; d0: string | null; d1: string | null }>>`
      SELECT count(*)::bigint AS n, min("reportDate")::text AS d0, max("reportDate")::text AS d1
      FROM "SellfoxProductDailySnapshot"
      WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}
        AND "reportDate" BETWEEN ${from} AND ${to}`,
    prisma.$queryRaw<Array<{ n: bigint; d0: string | null; d1: string | null }>>`
      SELECT count(*)::bigint AS n, min("reportDate")::text AS d0, max("reportDate")::text AS d1
      FROM "SellfoxAdsProductDaily"
      WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}
        AND "reportDate" BETWEEN ${from} AND ${to}`,
  ]);
  const snapshot = {
    organizationId, workspaceId, window: { from, to },
    sourceRows: {
      sales: Number(sales[0]?.n ?? 0), productDaily: Number(profit[0]?.n ?? 0), adsProduct: Number(ads[0]?.n ?? 0),
    },
    sourceDates: {
      sales: [sales[0]?.d0 ?? null, sales[0]?.d1 ?? null],
      productDaily: [profit[0]?.d0 ?? null, profit[0]?.d1 ?? null],
      adsProduct: [ads[0]?.d0 ?? null, ads[0]?.d1 ?? null],
    },
    mode: args.includes("--apply") ? "apply" : "dry-run",
  };
  console.log(JSON.stringify(snapshot, null, 2));

  // overview 用整个 workspace 全量（低成本单行 rollup），不受日期窗限制。
  const input: AggRefreshInput = {
    organizationId, workspaceId, resource: "sales", shopExternalIds: [],
    startDate: from, endDate: to, runId: `agg-backfill-${Date.now()}`,
  };
  const statements = [
    { name: "sales", sql: salesAggDailyStatement(input) },
    { name: "profit", sql: profitAggDailyStatement(input) },
    { name: "ads", sql: adsAggDailyStatement(input) },
    { name: "overview", sql: overviewAggStatement(input) },
  ].filter((s): s is { name: string; sql: NonNullable<typeof s.sql> } => s.sql !== null);

  if (!args.includes("--apply")) {
    console.log("DRY_RUN: 未写入。确认日期窗与行数后加 --apply 回填。");
    return;
  }

  const startedAt = performance.now();
  for (const statement of statements) {
    await prisma.$executeRaw(statement.sql);
  }
  console.log(JSON.stringify({
    applied: statements.map((s) => s.name),
    elapsedMs: Math.round(performance.now() - startedAt),
    note: "幂等派生写入完成；随后运行 sellfox-aggregate-reconcile --all 验证 0 差异。页面读路径未改变。",
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "回填失败。");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
