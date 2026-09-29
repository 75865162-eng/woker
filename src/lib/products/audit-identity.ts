import type {
  Product,
  ProductOperationProgress,
  ProductOperationStage,
} from "@/lib/products/types";
import {
  buildWorkflowEvent,
  getCurrentWorkflowAssignee,
  getProductWorkflowStage,
} from "@/lib/products/workflow";
import {
  normalizeOperationsProgress,
  summarizeOperationsProgressChanges,
} from "@/lib/products/operations-progress";

type ProductAuditUser = {
  id: string;
  name?: string;
};

type ProductAuditEventType = "product_saved" | "product_restored";

function actorName(user: ProductAuditUser) {
  return user.name?.trim() || "未知账号";
}

function stripOperationAudit(progress?: ProductOperationProgress) {
  if (!progress) return undefined;

  return {
    orderQuantity: progress.orderQuantity,
    shipDate: progress.shipDate,
    forecastMonthlySales: progress.forecastMonthlySales,
    forecastPrice: progress.forecastPrice,
    stages: progress.stages.map((stage) => stripStageAudit(stage)),
  };
}

function stripStageAudit(stage: ProductOperationStage) {
  return {
    id: stage.id,
    status: stage.status,
    owner: stage.owner,
    plannedAt: stage.plannedAt,
    completedAt: stage.completedAt,
    note: stage.note,
    updatedAt: stage.updatedAt,
    evidenceFile: stage.evidenceFile,
  };
}

function operationContentChanged(left?: ProductOperationProgress, right?: ProductOperationProgress) {
  return JSON.stringify(stripOperationAudit(left)) !== JSON.stringify(stripOperationAudit(right));
}

function normalizeExistingWorkflowHistory(existingProduct?: Partial<Product>) {
  return [...(existingProduct?.workflowHistory ?? [])];
}

function reconcileWorkflowHistory(input: {
  product: Product;
  existingProduct?: Partial<Product>;
  user: ProductAuditUser;
  eventType: ProductAuditEventType;
  createdAt: Date;
}) {
  const existingHistory = normalizeExistingWorkflowHistory(input.existingProduct);

  if (input.eventType === "product_restored") {
    return [
      buildWorkflowEvent({
        stage: getProductWorkflowStage(input.product),
        actorUserId: input.user.id,
        actorName: actorName(input.user),
        assigneeName: getCurrentWorkflowAssignee(input.product),
        note: "恢复商品历史版本。",
        createdAt: input.createdAt,
      }),
      ...existingHistory,
    ].slice(0, 20);
  }

  const currentStage = getProductWorkflowStage(input.product);
  const previousStage = input.existingProduct
    ? getProductWorkflowStage(input.existingProduct as Product)
    : undefined;
  const requestedEvent = (input.product.workflowHistory ?? []).find(
    (event) => !existingHistory.some((existingEvent) => existingEvent.id === event.id),
  );
  const shouldAppendEvent = !input.existingProduct || currentStage !== previousStage;

  const requestedNewEvents = shouldAppendEvent
    ? [buildWorkflowEvent({
        stage: currentStage,
        actorUserId: input.user.id,
        actorName: actorName(input.user),
        assigneeName: requestedEvent?.assigneeName || getCurrentWorkflowAssignee(input.product),
        note: requestedEvent?.note || (input.existingProduct ? undefined : "创建商品并进入业务流程。"),
        createdAt: input.createdAt,
      })]
    : [];

  if (!input.existingProduct && requestedNewEvents.length === 0) {
    requestedNewEvents.push(buildWorkflowEvent({
      stage: getProductWorkflowStage(input.product),
      actorUserId: input.user.id,
      actorName: actorName(input.user),
      assigneeName: getCurrentWorkflowAssignee(input.product),
      note: "创建商品并进入业务流程。",
      createdAt: input.createdAt,
    }));
  }

  return [...requestedNewEvents, ...existingHistory].slice(0, 20);
}

function reconcileOperationsProgress(input: {
  product: Product;
  existingProduct?: Partial<Product>;
  user: ProductAuditUser;
  eventType: ProductAuditEventType;
  createdAt: Date;
}) {
  const submitted = input.product.operationsProgress;
  const existing = input.existingProduct?.operationsProgress;

  if (!submitted) {
    return existing;
  }

  if (existing && !operationContentChanged(existing, submitted) && input.eventType !== "product_restored") {
    return existing;
  }

  const before = normalizeOperationsProgress(existing);
  const after = normalizeOperationsProgress(submitted);
  const summary = input.eventType === "product_restored"
    ? "恢复商品历史版本，运营进度随版本恢复。"
    : summarizeOperationsProgressChanges(before, after);
  const now = input.createdAt.toISOString();

  return {
    ...submitted,
    updatedAt: now,
    updatedByUserId: input.user.id,
    updatedBy: actorName(input.user),
    history: [
      {
        id: `ops-${input.createdAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        changedAt: now,
        changedByUserId: input.user.id,
        changedBy: actorName(input.user),
        summary,
      },
      ...(existing?.history ?? []),
    ].slice(0, 50),
  } satisfies ProductOperationProgress;
}

export function stampProductAuditIdentity(input: {
  product: Product;
  existingProduct?: Partial<Product>;
  user: ProductAuditUser;
  eventType?: ProductAuditEventType;
  createdAt?: Date;
}): Product {
  const eventType = input.eventType ?? "product_saved";
  const createdAt = input.createdAt ?? new Date();

  return {
    ...input.product,
    workflowHistory: reconcileWorkflowHistory({
      product: input.product,
      existingProduct: input.existingProduct,
      user: input.user,
      eventType,
      createdAt,
    }),
    operationsProgress: reconcileOperationsProgress({
      product: input.product,
      existingProduct: input.existingProduct,
      user: input.user,
      eventType,
      createdAt,
    }),
  };
}
