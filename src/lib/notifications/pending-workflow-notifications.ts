import type { Prisma, UserNotification } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getProductWorkflowStage, normalizeAssigneeList, productWorkflowStageLabels } from "@/lib/products/workflow";
import type { Product } from "@/lib/products/types";

export type WorkflowNotificationCandidate = UserNotification & {
  currentProductId: string;
  currentSku: string;
  currentWorkspaceId: string;
  currentStatus: Product["status"];
  currentStage: Product["workflowStage"];
  currentDueAt: Date | null;
  currentOpsAssignee: string;
  currentDesignerAssignee: string;
  currentOpsAssignees: unknown;
  currentDesignerAssignees: unknown;
  recipientName: string;
};

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Read state is deliberately unrelated to whether the assigned work is still pending.
export function selectPendingWorkflowNotifications(candidates: WorkflowNotificationCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const metadata = item.metadata as Record<string, unknown> | null;
    if (!metadata || metadata.productId !== item.currentProductId || metadata.workspaceId !== item.currentWorkspaceId) return false;
    const stage = getProductWorkflowStage({ status: item.currentStatus, developer: "", workflowStage: item.currentStage });
    if (!["ops_confirming", "design_in_progress", "design_review"].includes(stage) || metadata.stage !== stage) return false;
    const assignees = stage === "ops_confirming"
      ? normalizeAssigneeList(item.currentOpsAssignee, stringList(item.currentOpsAssignees))
      : normalizeAssigneeList(item.currentDesignerAssignee, stringList(item.currentDesignerAssignees));
    if (!assignees.includes(item.recipientName)) return false;
    const key = JSON.stringify([item.currentWorkspaceId, item.currentProductId, stage, item.currentDueAt]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item): UserNotification => {
    const stage = getProductWorkflowStage({ status: item.currentStatus, developer: "", workflowStage: item.currentStage });
    const overdue = Boolean(item.currentDueAt && item.currentDueAt.getTime() < Date.now());
    return {
      id: item.id, organizationId: item.organizationId, recipientUserId: item.recipientUserId,
      actorUserId: item.actorUserId, dedupeKey: item.dedupeKey,
      type: overdue ? "product_workflow_overdue" : "product_workflow",
      title: overdue ? "商品流转已超期" : "待处理的商品流转任务",
      entityType: item.entityType, entityId: item.entityId,
      metadata: { ...(item.metadata as Record<string, Prisma.JsonValue>),
        sku: item.currentSku, dueAt: item.currentDueAt?.toISOString() ?? null },
      message: `${item.currentSku} 当前处于${productWorkflowStageLabels[stage]}，处理期限：${item.currentDueAt ? item.currentDueAt.toLocaleString("zh-CN", { hour12: false }) : "期限未设置"}。`,
      readAt: item.readAt, createdAt: item.createdAt,
    };
  });
}

export async function loadPendingWorkflowNotifications(organizationId: string, recipientUserId: string) {
  // Scope by the indexed recipient and join the authoritative record by primary key.
  // Only current task instances are candidates; no full product payload or list projection is loaded.
  const candidates = await prisma.$queryRaw<WorkflowNotificationCandidate[]>`
    SELECT * FROM (
    SELECT DISTINCT ON (p.id) n.*, p.id AS "currentProductId", p.sku AS "currentSku", p."workspaceId" AS "currentWorkspaceId",
      p.status AS "currentStatus", p."workflowStage" AS "currentStage", p."workflowDueAt" AS "currentDueAt",
      p."opsAssignee" AS "currentOpsAssignee", p."designerAssignee" AS "currentDesignerAssignee",
      p.payload->'opsAssignees' AS "currentOpsAssignees",
      p.payload->'designerAssignees' AS "currentDesignerAssignees", r.name AS "recipientName"
    FROM "UserNotification" n
    JOIN "ProductRecord" p ON p.id = n.metadata->>'productId'
      AND p."organizationId" = n."organizationId" AND p."workspaceId" = n.metadata->>'workspaceId'
    JOIN "TeamRosterMember" r ON r.id = n."recipientUserId" AND r."organizationId" = n."organizationId"
      AND r.status NOT IN ('disabled', 'archived')
    WHERE n."organizationId" = ${organizationId} AND n."recipientUserId" = ${recipientUserId}
      AND n.type IN ('product_workflow', 'product_workflow_overdue')
      AND n.metadata->>'stage' = p."workflowStage"
      AND p."workflowStage" IN ('ops_confirming', 'design_in_progress', 'design_review')
    ORDER BY p.id, n."createdAt" DESC, n.id DESC
    ) pending
    ORDER BY "createdAt" DESC, id DESC
  `;
  return selectPendingWorkflowNotifications(candidates);
}
