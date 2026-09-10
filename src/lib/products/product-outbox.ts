import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { prisma } from "@/lib/db/prisma";
import { invalidateProductListResponseCaches } from "@/lib/products/product-list-cache";
import { createWorkflowNotifications } from "@/lib/products/workflow-notifications";
import type { Product } from "@/lib/products/types";

type ProductOutboxPayload = {
  product: Product;
  previousProduct?: Partial<Product>;
  actorName: string;
};

async function getAuditUser(event: { userId: string | null; organizationId: string }) {
  if (!event.userId) return undefined;

  const user = await prisma.user.findUnique({
    where: { id: event.userId },
    include: {
      memberships: {
        where: { organizationId: event.organizationId },
        include: { organization: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  const membership = user?.memberships[0];
  if (!user || user.status !== "active" || !membership) return undefined;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: membership.role,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
  };
}

export async function processProductOutboxEvent(eventId: string) {
  const claimed = await prisma.productOutboxEvent.updateMany({
    where: {
      id: eventId,
      status: { in: ["queued", "failed"] },
      availableAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    data: {
      status: "running",
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  if (!claimed.count) return;

  const event = await prisma.productOutboxEvent.findUnique({ where: { id: eventId } });
  if (!event) return;

  try {
    const payload = event.payload as unknown as ProductOutboxPayload;
    const auditUser = await getAuditUser(event);

    if (auditUser && event.eventType === "product_saved") {
      await recordDataChangeVersion({
        user: auditUser,
        entityType: "product",
        entityId: event.entityId,
        action: "product_save",
        summary: `${payload.product.sku} ${payload.product.chineseName}`,
        payload: payload.product as unknown as Prisma.InputJsonValue,
        idempotencyKey: event.id,
        scope: {
          workspaceId: event.workspaceId,
          accountId: event.accountId,
          marketplace: event.marketplace,
        },
      });
    }

    if (auditUser && event.eventType === "product_saved") {
      await createWorkflowNotifications({
        user: {
          id: auditUser.id,
          name: payload.actorName || auditUser.name,
          organizationId: auditUser.organizationId,
        },
        product: payload.product,
        previousProduct: payload.previousProduct,
        idempotencyKey: event.id,
      });
    }

    await invalidateProductListResponseCaches(`${event.organizationId}:${event.workspaceId}:`);
    await prisma.productOutboxEvent.update({
      where: { id: event.id },
      data: { status: "done", processedAt: new Date(), lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product outbox processing failed.";
    const attempts = event.attempts;
    await prisma.productOutboxEvent.update({
      where: { id: event.id },
      data: {
        status: attempts >= 5 ? "failed" : "queued",
        availableAt: new Date(Date.now() + Math.min(60_000, 2 ** attempts * 1000)),
        lastError: message,
      },
    });
    throw error;
  }
}

export async function enqueuePendingProductOutboxEvents(limit = 50) {
  return prisma.productOutboxEvent.findMany({
    where: {
      status: { in: ["queued", "failed"] },
      availableAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
}

export async function recoverStaleProductOutboxEvents(staleAfterMs = 10 * 60_000) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  await prisma.productOutboxEvent.updateMany({
    where: {
      status: "running",
      updatedAt: { lt: cutoff },
      attempts: { lt: 5 },
    },
    data: {
      status: "queued",
      availableAt: new Date(),
      lastError: "Outbox 处理进程异常退出，已自动恢复重试。",
    },
  });
}

export async function markExpiredProductAttachmentsOrphaned() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.productAttachmentBinding.updateMany({
    where: {
      status: "temporary",
      updatedAt: { lt: cutoff },
    },
    data: { status: "orphan" },
  });
  await prisma.fileObject.updateMany({
    where: {
      productBindingStatus: "temporary",
      updatedAt: { lt: cutoff },
    },
    data: { productBindingStatus: "orphan" },
  });
}
