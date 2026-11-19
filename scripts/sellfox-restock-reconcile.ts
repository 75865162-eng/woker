// 赛狐补货建议物化对账 CLI（默认只读）。
// 逐行逐字段比对「物化快照」与「实时 buildRestockRows 计算」，0 差异才允许
// 把读路径切到 source=materialized。这是对账门禁，不是缓存预热。
//
// 用法：
//   ... sellfox-restock-reconcile.ts --organization-id=ID --workspace-id=ID
//        [--today=YYYY-MM-DD] [--dimension=asin|msku|both] [--store-id=ID ...]
import { prisma } from "@/lib/db/prisma";
import { reconcileSellfoxRestockSnapshot } from "@/lib/sellfox/restock-materialize";
import { sellfoxDateAt } from "@/lib/sellfox/sync-contract";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "sellfox-restock-reconcile --organization-id=ID --workspace-id=ID " +
      "[--today=YYYY-MM-DD] [--dimension=asin|msku|both] [--store-id=ID ...]\n" +
      "逐行逐字段比对物化补货快照与实时算法结果，0 差异才允许 source=materialized 切读。",
    );
    return;
  }
  const organizationId = argValue(args, "organization-id");
  const workspaceId = argValue(args, "workspace-id");
  if (!organizationId || !workspaceId) throw new Error("必须显式指定 --organization-id 与 --workspace-id。");
  const today = argValue(args, "today") ?? sellfoxDateAt(new Date());
  const dimension = argValue(args, "dimension") ?? "both";
  if (!["asin", "msku", "both"].includes(dimension)) throw new Error("--dimension 只能是 asin/msku/both。");
  const storeIds = args.filter((a) => a.startsWith("--store-id=")).map((a) => a.slice("--store-id=".length));
  const dimensions = dimension === "both" ? ["asin", "msku"] as const : [dimension as "asin" | "msku"];

  let allOk = true;
  for (const dim of dimensions) {
    const report = await reconcileSellfoxRestockSnapshot({
      organizationId, workspaceId, dimension: dim, today,
      storeIds: storeIds.length ? storeIds : undefined,
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) allOk = false;
  }
  if (!allOk) {
    throw new Error("补货物化对账未通过：存在逐行差异，禁止切读 source=materialized。");
  }
  console.log("RESTOCK_RECONCILE_OK: 物化快照与实时算法逐行 0 差异，可按灰度清单启用 source=materialized。");
}

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "对账失败。");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
