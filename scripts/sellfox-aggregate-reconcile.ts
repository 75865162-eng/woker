// P2 聚合口径对账 CLI。默认只读；对账通过（0 差异）才允许把读路径切到聚合表。
// 用法：sellfox-aggregate-reconcile --organization-id=ID --workspace-id=ID [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
import { prisma } from "@/lib/db/prisma";
import {
  reconcileSalesAggDaily, reconcileProfitAggDaily, reconcileAdsAggDaily,
  reconcileOverviewAgg, reconcileInventoryAgg, assertReconciled, type ReconcileReport,
} from "@/lib/sellfox/aggregate-reconcile";
import { sellfoxDateAt } from "@/lib/sellfox/sync-contract";
import { publishAggregateVerdict } from "@/lib/sellfox/aggregate-read-state";
import { aggregateReadEnabled } from "@/lib/sellfox/aggregate-read-gate";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("sellfox-aggregate-reconcile --organization-id=ID --workspace-id=ID [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--all] [--publish-verdict]\n对同一 org/ws/日期窗比对源表权威口径与预聚合表，逐字段输出差异。0 差异才允许切读路径。\n默认只核对 sales（兼容既有调用）；--all 同时核对 sales/profit/ads/inventory/overview 五张预聚合表。\n--publish-verdict：对账 0 差异后把 verdict 写入 Redis，供读路径闸门安全地切到预聚合表；不指定则只读不发布。");
    return;
  }
  const allowed = new Set(["organization-id", "workspace-id", "from", "to"]);
  const options = new Map<string, string>();
  for (const arg of args) {
    if (arg === "--all") continue; // boolean flag, has no =value
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || options.has(match[1])) throw new Error("参数无效或重复，请使用 --help。");
    options.set(match[1], match[2]);
  }
  const organizationId = options.get("organization-id");
  const workspaceId = options.get("workspace-id");
  if (!organizationId || !workspaceId) throw new Error("必须显式指定 --organization-id 与 --workspace-id。");
  const to = options.get("to") ?? sellfoxDateAt(new Date(), -1);
  const from = options.get("from") ?? to;

  const query = async (sql: string, values?: unknown[]) => {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...(values ?? []));
    return { rows };
  };

  const scope = { organizationId, workspaceId, from, to };
  // 默认只跑 sales（保持既有调用方行为不变）；--all 覆盖全部五张预聚合表。
  const all = args.includes("--all");
  const reports: Array<{ name: string; report: ReconcileReport }> = [
    { name: "sales", report: await reconcileSalesAggDaily(query, scope) },
  ];
  if (all) {
    reports.push(
      { name: "profit", report: await reconcileProfitAggDaily(query, scope) },
      { name: "ads", report: await reconcileAdsAggDaily(query, scope) },
      { name: "inventory", report: await reconcileInventoryAgg(query, scope) },
      { name: "overview", report: await reconcileOverviewAgg(query, scope) },
    );
  }
  for (const { name, report } of reports) {
    console.log(JSON.stringify({ domain: name, ...report }, null, 2));
  }
  for (const { report } of reports) {
    assertReconciled(report);
  }
  const publish = args.includes("--publish-verdict");
  if (publish) {
    if (!aggregateReadEnabled()) {
      throw new Error("SELLFOX_AGG_READ_ENABLED 未开启：拒绝发布 verdict（避免切读开关关闭时写入孤立 verdict）。");
    }
    for (const { name, report } of reports) {
      const ok = await publishAggregateVerdict(organizationId, workspaceId, name, {
        ok: report.ok, at: new Date().toISOString(), sourceRows: report.sourceRows, aggregateRows: report.aggregateRows,
      });
      console.log(`VERDICT_PUBLISH: ${name} ok=${report.ok} published=${ok}`);
    }
  }
  console.log(`RECONCILE_OK: ${reports.map((r) => r.name).join(",")} 0 差异${publish ? "，verdict 已发布" : "；如需切读路径请加 --publish-verdict"}。`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
