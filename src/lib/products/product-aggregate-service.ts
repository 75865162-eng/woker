import { Prisma } from "@prisma/client";
import type { Product } from "@/lib/products/types";
import { collectProductAttachmentReferences } from "@/lib/products/attachment-bindings";
import {
  findProductRecordBySku,
  saveProductRecord,
  type ProductRecordScope,
  type ProductRecordUser,
} from "@/lib/products/product-record-repository";
import { getProductWorkflowStage } from "@/lib/products/workflow";

type ProductRecord = Awaited<ReturnType<typeof findProductRecordBySku>>;

export async function saveProductAggregate(
  tx: Prisma.TransactionClient,
  input: {
    product: Product;
    user: ProductRecordUser;
    scope: ProductRecordScope;
    expectedRevision?: number;
    allowStatusRollback?: boolean;
    existingRecord?: ProductRecord | null;
    bindAttachments?: boolean;
    eventType?: "product_saved" | "product_restored";
  },
) {
  const existingRecord =
    input.existingRecord === undefined
      ? await findProductRecordBySku(tx, input.scope, input.product.sku)
      : input.existingRecord;
  const existingProduct = existingRecord?.payload as Partial<Product> | undefined;
  const saved = await saveProductRecord(tx, {
    product: input.product,
    user: input.user,
    scope: input.scope,
    expectedRevision: input.expectedRevision,
    allowStatusRollback: input.allowStatusRollback,
    existingRecord,
  });

  if (input.bindAttachments !== false) {
    await bindProductAttachments(tx, {
      organizationId: input.scope.organizationId,
      workspaceId: input.scope.workspaceId,
      product: saved.product,
    });
  }

  const outboxEvent = await tx.productOutboxEvent.create({
    data: {
      organizationId: input.scope.organizationId,
      userId: input.user.id,
      workspaceId: input.scope.workspaceId,
      accountId: input.scope.accountId,
      marketplace: input.scope.marketplace,
      eventType: input.eventType ?? "product_saved",
      entityType: "product",
      entityId: saved.product.sku,
      payload: {
        productRecordId: saved.product.id,
        revision: saved.product.revision,
        previousWorkflowStage: existingProduct ? getProductWorkflowStage(existingProduct as Product) : null,
        actorName: input.user.name ?? "",
      } as Prisma.InputJsonValue,
    },
  });

  await tx.workspaceScope.upsert({
    where: {
      organizationId_id: {
        organizationId: input.scope.organizationId,
        id: input.scope.workspaceId,
      },
    },
    create: {
      organizationId: input.scope.organizationId,
      id: input.scope.workspaceId,
      name: input.scope.workspaceId === "default" ? "默认工作区" : input.scope.workspaceId,
      accountId: input.scope.accountId,
      marketplace: input.scope.marketplace,
      isDefault: input.scope.workspaceId === "default",
    },
    update: {
      accountId: input.scope.accountId,
      marketplace: input.scope.marketplace,
    },
  });
  // ProductRecord revision is the source-of-truth version. Reusing it here
  // keeps the audit history aligned with the optimistic-concurrency guard.
  const auditVersion = saved.product.revision;
  await tx.dataChangeVersion.create({
    data: {
      organizationId: input.scope.organizationId,
      userId: input.user.id,
      idempotencyKey: outboxEvent.id,
      workspaceId: input.scope.workspaceId,
      accountId: input.scope.accountId,
      marketplace: input.scope.marketplace,
      entityType: "product",
      entityId: saved.product.sku,
      version: auditVersion,
      action: input.eventType === "product_restored" ? "product_restore" : "product_save",
      summary: input.eventType === "product_restored"
        ? `${saved.product.sku} 恢复商品版本`
        : `${saved.product.sku} ${saved.product.chineseName}`,
      payload: saved.product as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.auditLog.create({
    data: {
      organizationId: input.scope.organizationId,
      userId: input.user.id,
      idempotencyKey: outboxEvent.id,
      action: input.eventType === "product_restored" ? "product_restore" : "product_save",
      entityType: "product",
      entityId: saved.product.sku,
      metadata: {
        version: auditVersion,
        workspaceId: input.scope.workspaceId,
        accountId: input.scope.accountId,
        marketplace: input.scope.marketplace,
        summary: input.eventType === "product_restored"
          ? `${saved.product.sku} 恢复商品版本`
          : `${saved.product.sku} ${saved.product.chineseName}`,
        outboxEventId: outboxEvent.id,
      },
    },
  });

  return {
    ...saved,
    existingProduct,
    outboxEventId: outboxEvent.id,
  };
}

async function bindProductAttachments(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    workspaceId: string;
    product: Product;
  },
) {
  const attachmentReferences = collectProductAttachmentReferences(input.product);
  const attachmentIds = attachmentReferences.map((reference) => reference.fileId);
  if (attachmentIds.length) {
    const files = await tx.fileObject.findMany({
      where: {
        id: { in: attachmentIds },
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
      },
      select: { id: true },
    });
    if (files.length !== attachmentIds.length) {
      throw new Error("商品包含无效或无权限的附件引用，请重新上传附件后再保存。");
    }

    const existingBindings = await tx.productAttachmentBinding.findMany({
      where: { fileId: { in: attachmentIds } },
      select: { fileId: true, productSku: true, status: true },
    });
    const conflictingBinding = existingBindings.find((binding) =>
      binding.productSku !== input.product.sku && binding.status === "linked");
    if (conflictingBinding) {
      throw new Error("商品附件已被其他商品占用，请重新上传附件后再保存。");
    }
  }

  const previousBindings = await tx.productAttachmentBinding.findMany({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      productSku: input.product.sku,
      status: "linked",
    },
    select: { id: true, fileId: true },
  });
  const currentAttachmentIds = new Set(attachmentIds);
  const removedBindings = previousBindings.filter((binding) => !currentAttachmentIds.has(binding.fileId));
  if (removedBindings.length) {
    await tx.productAttachmentBinding.updateMany({
      where: { id: { in: removedBindings.map((binding) => binding.id) } },
      data: { status: "orphan", linkedAt: null },
    });
    await tx.fileObject.updateMany({
      where: { id: { in: removedBindings.map((binding) => binding.fileId) } },
      data: { productBindingStatus: "orphan" },
    });
  }

  for (const reference of attachmentReferences) {
    await tx.productAttachmentBinding.upsert({
      where: { fileId: reference.fileId },
      create: {
        fileId: reference.fileId,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        productSku: input.product.sku,
        fieldPath: reference.fieldPath,
        status: "linked",
        linkedAt: new Date(),
      },
      update: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        productSku: input.product.sku,
        fieldPath: reference.fieldPath,
        status: "linked",
        linkedAt: new Date(),
      },
    });
  }
  if (attachmentIds.length) {
    await tx.fileObject.updateMany({
      where: { id: { in: attachmentIds } },
      data: { productBindingStatus: "linked" },
    });
  }
}
