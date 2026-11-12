import { SyncInputError } from "./policy";
import { sellerArchivePolicy } from "./seller-archive-policy";

/** Only checkpoint-preserving retries through the existing approval service. */
export const skillSyncRetryResources = ["fba_inventory_report", "reserved_inventory", "stranded_inventory", "orders", "finance", "returns", "reimbursements", "inventory_events", "fulfillment", "catalog_items", "listing_details", "promotions"] as const;

export function assertSkillSyncSourcePublishable(resource: string, domainPolicy: unknown) {
  if (sellerArchivePolicy(resource, domainPolicy)) throw new SyncInputError("当前来源只允许归档卖家级原件，不会发布站点级 Skill 数据；请先通过现有审批流程完成报告归属核验，避免重复采集。", 409);
}

export function skillSyncRetryCommand(resource: string, task: { id: string; resource: string; status: string; stage: string } | null, args: Record<string, unknown>) {
  if (!(skillSyncRetryResources as readonly string[]).includes(resource)) throw new SyncInputError("此数据域暂不支持指定任务重试。");
  if (args.dateFrom !== undefined || args.dateTo !== undefined || args.eventType !== undefined) throw new SyncInputError("任务重试沿用原时间窗和检查点，不允许同时指定新日期或事件类型。");
  if (!task || task.resource !== resource) throw new SyncInputError("任务不在当前账号和站点的数据范围内。", 403);
  if (["PURGED", "BINDING_DISABLED"].includes(task.stage)) throw new SyncInputError("当前任务不能申请重试。", 409);
  if ((skillSyncRetryResources as readonly string[]).includes(resource) && task.status === "PAUSED") return { action: "control-task", id: task.id, control: "resume" };
  const cancelledProduct = ["catalog_items", "listing_details"].includes(resource) && task.status === "CANCELLED";
  if (!["FAILED", "BLOCKED", ...(resource === "orders" ? [] : ["PARTIAL_SUCCESS"])].includes(task.status) && !cancelledProduct) throw new SyncInputError("当前任务不能申请重试。", 409);
  return { action: "control-task", id: task.id, control: "retry" };
}
