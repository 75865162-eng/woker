import { orderDetailGapWhere } from "./order-detail-coverage";
import { type OrderSyncPolicy, type OrderWindow } from "./orders";
import { Prisma, type AmazonSyncRun } from "@prisma/client";
import { digest } from "./approval-policy";
import type { SyncProcessorSource } from './processor-runtime';

/** Called under the source lock inside the final page commit. Never spends the
 * capacity needed by already-discovered current-window orders. */
export async function queueOrderBackfill(tx: Prisma.TransactionClient, run: AmazonSyncRun, source: SyncProcessorSource, policy: OrderSyncPolicy, window: OrderWindow) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const details = policy.details!, policyDigest = digest(details);
  const workWhere = { ...scope, sourceId: source.id, policyDigest, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to) };
  const used = await tx.amazonOrderDetailWork.count({ where: workWhere });
  const remaining = Math.max(0, details.maxOrders - used);
  const previous = await tx.amazonOrderRecord.findMany({ where: {
    ...scope, sourceId: source.id, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId,
    sourceUpdatedAt: { lte: new Date(window.to) },
    ...orderDetailGapWhere(policyDigest, tx.amazonOrderRecord.fields.sourceUpdatedAt),
    detailWork: { none: workWhere },
  }, orderBy: [{ sourceUpdatedAt: "desc" }, { id: "asc" }], take: remaining + 1,
    select: { id: true, amazonOrderId: true, sourceUpdatedAt: true } });
  const selected = previous.slice(0, remaining);
  if (selected.length) {
    const work = selected.map(row => {
      const key = { sourceId: source.id, amazonOrderId: row.amazonOrderId, listedUpdatedAt: row.sourceUpdatedAt, policyDigest };
      return { ...scope, id: digest(key), ...key, orderRecordId: row.id, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), status: "PENDING" };
    });
    await tx.amazonOrderDetailWork.createMany({ data: work, skipDuplicates: true });
    // A previously successful work item can become a gap again (for example,
    // detail projection restoration). Reopen only rows selected by the live gap
    // predicate under the source lock; a successful old marker is not evidence
    // that the current business detail is still complete.
    await tx.amazonOrderDetailWork.updateMany({ where: { ...scope, sourceId: source.id, policyDigest, id: { in: work.map(item => item.id) }, status: { in: ["PENDING", "SUCCEEDED"] } }, data: { status: "PENDING", completedAt: null, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to) } });
  }
  return { enabled: true, selected: selected.length, deferred: previous.length > remaining };
}
