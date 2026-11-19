// P2 聚合口径对账 CLI。默认只读；对账通过（0 差异）才允许把读路径切到聚合表。
// 用法：sellfox-aggregate-reconcile --organization-id=ID --workspace-id=ID [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
import { prisma } from "@/lib/db/prisma";
import {
  reconcileSalesAggDaily, assertReconciled,
} from "@/lib/sellfox/aggregate-reconcile";
import { sellfoxDateAt } from "@/lib/sellfox/sync-contract";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("sellfox-aggregate-reconcile --organization-id=ID --workspace-id=ID [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]\n对同一 org/ws/日期窗比对源表权威口径与预聚合表，逐字段输出差异。0 差异才允许切读路径。");
    return;
  }
  const allowed = new Set(["organization-id", "workspace-id", "from", "to"]);
  const options = new Map<string, string>();
  for (const arg of args) {
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

  const report = await reconcileSalesAggDaily(query, { organizationId, workspaceId, from, to });
  console.log(JSON.stringify(report, null, 2));
  assertReconciled(report);
  console.log("RECONCILE_OK: 0 差异，可在预发按变更清单切换读路径。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
