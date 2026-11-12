import { exportFinanceReplica, exportFinanceReplicaPage } from "./finance-replica";
import { exportOrderReplica, exportOrderReplicaPage } from "./order-replica";
import { exportAdsReportReplica } from "@/lib/amazon-ads/report-replica";
import { exportAdsEntityReplica } from "@/lib/amazon-ads/entity-replica";
import { prisma } from "@/lib/db/prisma";
import { assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import type { CloudRelayEnvelope } from "@/lib/amazon/cloud-relay-protocol";
import { amazonDataAccess, sellerAccessWhere } from "./data-access";
import { applyChange, assertChangePermission, changeView, decideChange, requestChange, approvalSelect } from "./change-approval";
import { requireSyncCenter, SyncInputError } from "./policy";
import { exportSnapshotReplica } from "./inventory-replica";

/** The signed relay proves which ERP server sent the request, never the user's
 * account access or approval. Resolve those again from the cloud database.
 */
export async function executeCloudRelay(envelope: CloudRelayEnvelope) {
  assertAmazonCloudExecution();
  const { scope, actorUserId: actor, operation: op, requestId } = envelope;
  requireSyncCenter(scope);
  const sourcesFor = async (sourceIds?: string[]) => {
    const access = await amazonDataAccess(scope, actor);
    const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, ...sellerAccessWhere(access), ...(sourceIds ? { id: { in: sourceIds } } : {}) }, select: { id: true, sellerAccountId: true } });
    if (sourceIds && (sources.length !== sourceIds.length || new Set(sources.map(source => source.sellerAccountId)).size !== 1)) throw new SyncInputError("云端同步目标超出当前单账号范围。", 403);
    return sources;
  };
  const wrap = (result: Record<string, unknown>) => ({ ...result, requestId, executionLocation: "cloud" as const });
  if (op.kind === "finance-replica-page") return wrap(await exportFinanceReplicaPage(scope, actor, op.sourceId, op.cursor));
  if (op.kind === "finance-replica") return wrap({ replica: await exportFinanceReplica(scope, actor, op.sourceId) });
  if (op.kind === "orders-replica-page") return wrap(await exportOrderReplicaPage(scope, actor, op.sourceId, op.cursor));
  if (op.kind === "orders-replica") return wrap({ replica: await exportOrderReplica(scope, actor, op.sourceId) });
  if (op.kind === "ads-reports-replica") return wrap({ replica: await exportAdsReportReplica(scope, actor, op.profileRecordId) });
  if (op.kind === "ads-entities-replica") return wrap({ replica: await exportAdsEntityReplica(scope, actor, op.profileRecordId) });
  if (op.kind === "inventory-replica" || op.kind === "catalog-replica") return wrap({ replica: await exportSnapshotReplica(scope, actor, op.sourceId, op.kind === "catalog-replica" ? "catalog" : "inventory") });
  if (op.kind === "list") {
    const sources = await sourcesFor();
    const sourceIds = sources.map(source => source.id);
    const requests = await prisma.amazonDataCenterChangeRequest.findMany({ where: { ...scope, operation: "run", sourceIds: { hasSome: sourceIds } }, select: approvalSelect, orderBy: { createdAt: "desc" }, take: 200 });
    return wrap({ requests: requests.filter(row => row.sourceIds.length && row.sourceIds.every(id => sourceIds.includes(id))), limit: 200 });
  }
  if (op.kind === "request") {
    const ids = op.command.sourceIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) throw new SyncInputError("云端同步来源无效。", 400);
    await sourcesFor(ids as string[]);
    return wrap({ changeRequest: await requestChange(scope, actor, op.command, requestId) });
  }
  const row = await prisma.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id: op.id, operation: "run" } });
  if (!row) throw new SyncInputError("云端审批不存在；本地旧审批不能冒充云端审批。", 404);
  await sourcesFor(row.sourceIds);
  if (op.kind === "decide") {
    await assertChangePermission(scope, actor, "approve", prisma);
    if (row.status === op.decision && (op.decision !== "APPROVED" || row.approvedByUserId === actor)) return wrap({ changeRequest: changeView(row) });
    return wrap({ changeRequest: await decideChange(scope, actor, row.id, op.decision, op.reason) });
  }
  if (row.requestedByUserId !== actor) throw new SyncInputError("必须由原始申请用户提交云端执行。", 403);
  await assertChangePermission(scope, actor, "run", prisma);
  if (row.status !== "APPLIED") {
    try { await applyChange(scope, actor, row.id); }
    catch (error) {
      // A concurrent replay may have won the existing approval claim.
      const current = await prisma.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id: row.id }, select: { status: true } });
      if (current?.status !== "APPLIED") throw error;
    }
  }
  await sourcesFor(row.sourceIds);
  const tasks = await prisma.amazonSyncRun.findMany({ where: { ...scope, executionApprovalId: row.id, requestedByUserId: actor, sourceId: { in: row.sourceIds } }, select: { id: true, sourceId: true, resource: true, status: true, requestedByUserId: true, executionApprovalId: true }, orderBy: { id: "asc" }, take: 100 });
  if (!tasks.length) throw new SyncInputError("云端审批已应用，但任务记录尚未确认；请核对云端状态。", 409);
  return wrap({ applied: true, changeRequestId: row.id, tasks, amazonExecutionCompleted: false });
}
