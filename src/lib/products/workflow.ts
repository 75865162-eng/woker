import type { Product, ProductWorkflowEvent, ProductWorkflowStage } from "@/lib/products/types";

type ProductWorkflowLike = Pick<
  Product,
  | "status"
  | "developer"
  | "selectionOwner"
  | "opsAssignee"
  | "opsAssignees"
  | "designerAssignee"
  | "designerAssignees"
  | "workflowStage"
  | "workflowDueAt"
  | "workflowHistory"
>;

export const productWorkflowStageLabels: Record<ProductWorkflowStage, string> = {
  selection_pending: "选品待提交",
  ops_confirming: "运营确认中",
  design_in_progress: "美工处理中",
  design_review: "美工待确认",
  done: "已完成",
  blocked: "已阻塞",
};

export const productWorkflowStageTones: Record<ProductWorkflowStage, "gray" | "blue" | "green" | "amber" | "red"> = {
  selection_pending: "gray",
  ops_confirming: "amber",
  design_in_progress: "blue",
  design_review: "amber",
  done: "green",
  blocked: "red",
};

export const productWorkflowStageOptions: Array<{ value: ProductWorkflowStage; label: string }> = Object.entries(
  productWorkflowStageLabels,
).map(([value, label]) => ({ value: value as ProductWorkflowStage, label }));

export const productWorkflowSlaDays = 3;

const dayMs = 24 * 60 * 60 * 1000;
const closedStages = new Set<ProductWorkflowStage>(["done", "blocked"]);

export function getProductWorkflowStage(product: ProductWorkflowLike): ProductWorkflowStage {
  if (product.status === "ops_review") return "ops_confirming";
  if (product.status === "design_in_progress") return "design_in_progress";
  if (product.status === "listing_confirming") return "design_review";
  if (product.status === "listed") return "done";
  if (product.status === "canceled" || product.status === "delisted" || product.status === "patent_risk") return "blocked";

  return product.workflowStage ?? "selection_pending";
}

export function getCurrentWorkflowAssignee(product: ProductWorkflowLike) {
  const stage = getProductWorkflowStage(product);

  if (stage === "ops_confirming") return formatAssigneeList(normalizeAssigneeList(product.opsAssignee, product.opsAssignees));
  if (stage === "design_in_progress" || stage === "design_review") {
    return formatAssigneeList(normalizeAssigneeList(product.designerAssignee, product.designerAssignees));
  }

  return product.selectionOwner ?? product.developer ?? "";
}

export function normalizeAssigneeList(primary?: string, list?: string[]) {
  const values = [...(list ?? []), ...(primary ? primary.split(/[、，,;\n\r]/u) : [])]
    .flatMap((value) => value.split(/[、，,;\n\r]/u))
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(values));
}

export function formatAssigneeList(values?: string[]) {
  return normalizeAssigneeList(undefined, values).join("、");
}

export function createWorkflowDueAt(startedAt = new Date(), days = productWorkflowSlaDays) {
  return new Date(startedAt.getTime() + days * dayMs).toISOString();
}

export function isProductWorkflowOverdue(product: ProductWorkflowLike, now = new Date()) {
  const stage = getProductWorkflowStage(product);

  if (closedStages.has(stage)) {
    return false;
  }

  if (!product.workflowDueAt) {
    return false;
  }

  return new Date(product.workflowDueAt).getTime() < now.getTime();
}

export function formatWorkflowDate(value?: string) {
  if (!value) return "--";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("zh-CN", { hour12: false });
}

export function buildWorkflowEvent(input: {
  stage: ProductWorkflowStage;
  actorName?: string;
  assigneeName?: string;
  note?: string;
  createdAt?: Date;
}): ProductWorkflowEvent {
  const createdAt = input.createdAt ?? new Date();

  return {
    id: `flow-${createdAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    stage: input.stage,
    stageLabel: productWorkflowStageLabels[input.stage],
    actorName: input.actorName,
    assigneeName: input.assigneeName,
    note: input.note,
    createdAt: createdAt.toISOString(),
  };
}

export function appendWorkflowEvent(product: Product, event: ProductWorkflowEvent): ProductWorkflowEvent[] {
  return [event, ...(product.workflowHistory ?? [])].slice(0, 20);
}
