import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { Product } from "@/lib/products/types";
import { createWorkflowDueAt, getProductWorkflowStage, normalizeAssigneeList, productWorkflowStageLabels } from "@/lib/products/workflow";

function getWorkflowNotificationAssignees(product: Product) {
  const stage = getProductWorkflowStage(product);

  if (stage === "ops_confirming") {
    return normalizeAssigneeList(product.opsAssignee, product.opsAssignees);
  }

  if (stage === "design_in_progress" || stage === "design_review") {
    return normalizeAssigneeList(product.designerAssignee, product.designerAssignees);
  }

  return [];
}

function getPreviousWorkflowStage(product?: Partial<Product>) {
  if (!product) return undefined;

  return getProductWorkflowStage({
    status: product.status ?? "pending",
    developer: product.developer ?? "",
    selectionOwner: product.selectionOwner,
    opsAssignee: product.opsAssignee,
    opsAssignees: product.opsAssignees,
    designerAssignee: product.designerAssignee,
    designerAssignees: product.designerAssignees,
    workflowStage: product.workflowStage,
    workflowDueAt: product.workflowDueAt,
    workflowHistory: product.workflowHistory,
  });
}

export async function createWorkflowNotifications(input: {
  user: { id: string; name: string; organizationId: string };
  product: Product;
  previousProduct?: Partial<Product>;
  idempotencyKey?: string;
}) {
  const stage = getProductWorkflowStage(input.product);
  const previousStage = getPreviousWorkflowStage(input.previousProduct);

  if (stage === previousStage || (stage !== "ops_confirming" && stage !== "design_in_progress")) {
    return;
  }

  const assigneeNames = getWorkflowNotificationAssignees(input.product);
  if (!assigneeNames.length) return;

  const members = await prisma.teamRosterMember.findMany({
    where: {
      organizationId: input.user.organizationId,
      name: { in: assigneeNames },
      status: { notIn: ["disabled", "archived"] },
    },
    select: { id: true, name: true },
  });
  if (!members.length) return;

  const memberships = await prisma.organizationMember.findMany({
    where: {
      organizationId: input.user.organizationId,
      userId: { in: members.map((member) => member.id) },
    },
    select: { userId: true },
  });
  const recipientIds = new Set(memberships.map((membership) => membership.userId));
  const dueAt = input.product.workflowDueAt || createWorkflowDueAt(new Date());
  const title = stage === "ops_confirming" ? "新的运营处理任务" : "新的美工处理任务";
  const productName = input.product.chineseName || input.product.englishName || input.product.sku;
  const message = `${input.user.name} 已将 ${input.product.sku} ${productName} 流转到${productWorkflowStageLabels[stage]}，处理期限：${new Date(dueAt).toLocaleString("zh-CN", { hour12: false })}。`;
  const notifications: Prisma.UserNotificationCreateManyInput[] = members
    .filter((member) => recipientIds.has(member.id))
    .map((member) => ({
      organizationId: input.user.organizationId,
      recipientUserId: member.id,
      actorUserId: input.user.id,
      dedupeKey: input.idempotencyKey ? `${input.idempotencyKey}:${member.id}` : undefined,
      type: "product_workflow",
      title,
      message,
      entityType: "product",
      entityId: input.product.sku,
      metadata: {
        productId: input.product.id,
        sku: input.product.sku,
        stage,
        stageLabel: productWorkflowStageLabels[stage],
        dueAt,
        assigneeName: member.name,
      },
    }));
  if (!notifications.length) return;

  const userNotificationDelegate = prisma.userNotification as unknown as
    | {
        createMany?: (args: {
          data: Prisma.UserNotificationCreateManyInput[];
          skipDuplicates?: boolean;
        }) => Promise<unknown>;
      }
    | undefined;

  if (typeof userNotificationDelegate?.createMany === "function") {
    await userNotificationDelegate.createMany({ data: notifications, skipDuplicates: true });
    return;
  }

  for (const notification of notifications) {
    await prisma.$executeRaw`
      INSERT INTO "UserNotification" (
        "organizationId", "recipientUserId", "actorUserId", "dedupeKey", "type", "title", "message", "entityType", "entityId", "metadata"
      ) VALUES (
        ${notification.organizationId}, ${notification.recipientUserId}, ${notification.actorUserId ?? null},
        ${notification.dedupeKey ?? null}, ${notification.type}, ${notification.title}, ${notification.message},
        ${notification.entityType ?? null}, ${notification.entityId ?? null},
        ${JSON.stringify(notification.metadata ?? null)}::jsonb
      )
      ON CONFLICT ("dedupeKey") DO NOTHING
    `;
  }
}
