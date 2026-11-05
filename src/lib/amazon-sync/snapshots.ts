import { amazonDataAccess, sourceAccessWhere } from "./data-access";
import { snapshotRowFilters } from "./snapshot-query";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { implementedDomain, requiredText, SyncInputError, type SyncScope } from "./policy";

/** Only completed, tenant-bound snapshots are readable; staging never becomes a public result. */
export async function readTaskSnapshot(scope: SyncScope, params: URLSearchParams, actor?: string) {
  const allowed = sourceAccessWhere(await amazonDataAccess(scope, actor));
  const taskId = requiredText(params.get("id"), "任务 ID");
  const page = Math.min(10000, Math.max(1, Math.floor(Number(params.get("page")) || 1))), pageSize = 50;
  return prisma.$transaction(async tx => {
    const task = await tx.amazonSyncRun.findFirst({ where: { ...scope, source: allowed, id: taskId, executionVersion: 2 } });
    if (!task) throw new SyncInputError("任务不存在。", 404);
    if (task.status !== "SUCCEEDED") throw new SyncInputError("任务尚未完整成功，暂存数据不可浏览。", 409);
    if (task.stage === "PURGED") throw new SyncInputError("此历史快照已按保留策略清理，任务摘要仍可查看。", 410);
    const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: task.sourceId! }, select: { id: true, resource: true, sellerAccountId: true, marketplaceId: true, activeRunId: true, authorization: { select: { amazonSellerId: true } } } });
    if (!source) throw new SyncInputError("数据源不存在。", 404);
    if (task.resource !== source.resource || !task.finishedAt) throw new SyncInputError("任务来源链不一致，快照暂不可浏览。", 409);
    const resource = implementedDomain(source.resource);
    if (["fulfillment", "pricing", "brand_analytics", "buy_box_history"].includes(resource)) throw new SyncInputError("该域请使用已发布观察版本查询入口。", 409);
    if (resource === "sales_traffic") throw new SyncInputError("销售流量请使用业务日报查询入口。");
    if (resource === "returns") throw new SyncInputError("退货请使用已发布报告查询入口。");
    if (resource === "finance") throw new SyncInputError("财务为逐页提交的增量记录，请使用财务交易入口。");
    if (resource === "orders") throw new SyncInputError("订单为逐页提交的增量记录，请使用订单列表查询入口。");
    const common = { ...snapshotRowFilters(params), ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId };
    const pagination = { skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ sellerSku: "asc" as const }, { id: "asc" as const }] };
    const [total, snapshotRows] = resource === "inventory"
      ? await Promise.all([
        tx.amazonInventorySnapshot.count({ where: { ...common, syncRunId: taskId } }),
        tx.amazonInventorySnapshot.findMany({ where: { ...common, syncRunId: taskId }, ...pagination, select: { sellerSku: true, asin: true, condition: true, fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true, reservedQuantity: true, unfulfillableQuantity: true, researchingQuantity: true, capturedAt: true, sourceUpdatedAt: true, dataVersion: true } }),
      ])
      : await Promise.all([
        tx.amazonCatalogSnapshot.count({ where: { ...common, sourceRunId: taskId } }),
        tx.amazonCatalogSnapshot.findMany({ where: { ...common, sourceRunId: taskId }, ...pagination, select: { sellerSku: true, asin: true, listingStatus: true, fulfillmentType: true, capturedAt: true, sourceUpdatedAt: true, dataVersion: true } }),
      ]);
    return {
      snapshot: { taskId, sourceId: source.id, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId, resource, sourceApi: resource === "inventory" ? "FBA Inventory v1 / getInventorySummaries" : "Listings Items 2021-08-01 / searchListingsItems", quality: "VALID", complete: true, batchId: task.id, dateField: params.get("dateField") ?? "capturedAt", dateTimeZone: "UTC", publishedAt: task.finishedAt, isCurrent: source.activeRunId === taskId },
      snapshotRows, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
