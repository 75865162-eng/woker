import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * 库存当前态围栏：只保留 SellfoxSnapshotHead 指向的采集批次。
 *
 * 默认库存浏览走 sellfox_inventory_current 视图（已按 Head 去重），但带
 * from/to/allDates 的浏览与导出会绕开视图直接查原始快照表。同一
 * (店铺, MSKU, 日期) 会被历次重采写入多行，方案 B 下历史批次不能重复计入
 * 当前库存与导出行数，因此这里按 Head 精确限定 (storeId, capturedAt)。
 *
 * Head 模型没有独立租户列，借 SellfoxStore 关系做租户围栏，与 restock-read.ts 一致。
 * 店铺尚无 Head 记录时返回空条件，不凭空隐藏数据（与 MCP versionScope 口径一致）。
 */
export async function sellfoxInventoryHeadWhere(
  scope: { organizationId: string; workspaceId: string },
  storeIds?: string[],
): Promise<Prisma.SellfoxFbaInventorySnapshotWhereInput> {
  const heads = await prisma.sellfoxSnapshotHead.findMany({
    where: {
      resource: "inventory",
      ...(storeIds ? { storeId: { in: storeIds } } : {}),
      SellfoxStore: { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
    },
    select: { storeId: true, capturedAt: true },
  });
  if (!heads.length) return {};
  return { OR: heads.map(({ storeId, capturedAt }) => ({ storeId, capturedAt })) };
}
