// 赛狐补货建议物化 CLI（派生写入，幂等，可重复执行）。
//
// 以赛狐 buildRestockRows 算法为权威，把全量补货建议按 (org,ws,dimension,inputDate)
// 物化为快照读模型，供冷启动免全量重算。写入为算法派生结果，不改变业务事实，
// 也不改任何页面读路径（API 默认走 live，source=materialized 才读物化快照）。
//
// 用法：
//   ... sellfox-restock-materialize.ts --organization-id=ID --workspace-id=ID
//        [--today=YYYY-MM-DD] [--store-id=ID ...] [--apply]
//   默认 dry-run 只盘点规模；--apply 才真正物化。
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { materializeSellfoxRestock } from "@/lib/sellfox/restock-materialize";
import { sellfoxDateAt } from "@/lib/sellfox/sync-contract";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "sellfox-restock-materialize --organization-id=ID --workspace-id=ID " +
      "[--today=YYYY-MM-DD] [--store-id=ID ...] [--apply]\n" +
      "把赛狐补货建议全量结果物化为快照（asin/msku 两种维度）。默认 dry-run；--apply 才写入。" +
      "幂等可重复执行。写入为算法派生结果，不改业务事实、不改页面读路径。",
    );
    return;
  }
  const organizationId = argValue(args, "organization-id");
  const workspaceId = argValue(args, "workspace-id");
  if (!organizationId || !workspaceId) throw new Error("必须显式指定 --organization-id 与 --workspace-id。");
  const today = argValue(args, "today") ?? sellfoxDateAt(new Date());
  const storeIds = args.filter((a) => a.startsWith("--store-id=")).map((a) => a.slice("--store-id=".length));

  if (!args.includes("--apply")) {
    const listingRows = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS n FROM sellfox_listing_current
      WHERE "organizationId"=${organizationId} AND "workspaceId"=${workspaceId}`);
    console.log(JSON.stringify({
      organizationId, workspaceId, inputDate: today,
      scope: storeIds.length ? { storeIds } : "all-stores",
      listingRows: Number(listingRows[0]?.n ?? 0),
      mode: "dry-run",
      note: "确认规模后加 --apply 物化 asin/msku 两种维度。",
    }, null, 2));
    return;
  }

  const startedAt = performance.now();
  const result = await materializeSellfoxRestock({
    organizationId, workspaceId, today,
    storeIds: storeIds.length ? storeIds : undefined,
  });
  console.log(JSON.stringify({ ...result, elapsedMs: Math.round(performance.now() - startedAt), note: "幂等物化完成；随后运行 sellfox-restock-reconcile 验证物化 vs 实时逐行 0 差异。页面读路径未改变。" }, null, 2));
}

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "物化失败。");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
