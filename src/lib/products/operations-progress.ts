import type {
  ProductOperationProgress,
  ProductOperationStage,
  ProductOperationStageId,
  ProductOperationStageStatus,
} from "@/lib/products/types";

export const operationStageDefinitions: Array<{ id: ProductOperationStageId; label: string }> = [
  { id: "selection_data", label: "竞品分析" },
  { id: "backend_upload", label: "赛狐上传" },
  { id: "order", label: "下单" },
  { id: "image_request", label: "图片需求" },
  { id: "copywriting", label: "文案编写" },
  { id: "design", label: "美工制作" },
  { id: "final_sample_confirmation", label: "大货终样确认" },
  { id: "shipping", label: "出货" },
  { id: "keyword_research", label: "关键词调研" },
  { id: "listing", label: "上架" },
];

export const operationStageEvidenceRequirements: Partial<
  Record<ProductOperationStageId, { label: string; accept: string; kind: "image" | "excel" }>
> = {
  image_request: {
    label: "图片需求表",
    accept: "image/*",
    kind: "image",
  },
  copywriting: {
    label: "文案表",
    accept: ".xlsx,.xls,.csv",
    kind: "excel",
  },
  final_sample_confirmation: {
    label: "样品确认单",
    accept: "image/*",
    kind: "image",
  },
  keyword_research: {
    label: "关键词调研表",
    accept: ".xlsx,.xls,.csv",
    kind: "excel",
  },
};

export const operationStageStatusOptions: Array<{ value: ProductOperationStageStatus; label: string }> = [
  { value: "not_started", label: "未开始" },
  { value: "in_progress", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "blocked", label: "受阻" },
];

export function createEmptyOperationsProgress(owner = ""): ProductOperationProgress {
  return {
    selectionDate: "",
    orderQuantity: 0,
    orderDate: "",
    shipDate: "",
    dailyAdBudget: 0,
    forecastMonthlySales: 0,
    forecastPrice: 0,
    stages: operationStageDefinitions.map(({ id }) => createEmptyStage(id, owner)),
    updatedAt: "",
    updatedBy: "",
    history: [],
  };
}

export function normalizeOperationsProgress(value: ProductOperationProgress | undefined, owner = ""): ProductOperationProgress {
  const fallback = createEmptyOperationsProgress(owner);
  if (!value) return fallback;

  const stagesById = new Map((value.stages ?? []).map((stage) => [stage.id, stage]));

  return {
    ...fallback,
    ...value,
    stages: operationStageDefinitions.map(({ id }) => ({
      ...createEmptyStage(id, owner),
      ...stagesById.get(id),
      id,
    })),
    history: value.history ?? [],
  };
}

export function calculateForecastMonthlyRevenue(progress: ProductOperationProgress) {
  return progress.forecastMonthlySales * progress.forecastPrice;
}

export function hasIncompleteOperationsProgress(progress?: ProductOperationProgress) {
  return !isOperationsProgressComplete(progress);
}

export function isOperationsProgressComplete(progress?: ProductOperationProgress) {
  return Boolean(progress?.stages?.length && progress.stages.every(isOperationStageComplete));
}

export function isOperationStageComplete(stage: ProductOperationStage) {
  if (stage.status !== "completed") return false;
  const requirement = operationStageEvidenceRequirements[stage.id];
  return !requirement || Boolean(stage.evidenceFile?.fileName);
}

export function summarizeOperationsProgressChanges(before: ProductOperationProgress, after: ProductOperationProgress) {
  const changes: string[] = [];
  const scalarFields: Array<[keyof ProductOperationProgress, string]> = [
    ["orderQuantity", "下单数量"],
    ["shipDate", "出货日期"],
    ["forecastMonthlySales", "预估月销"],
    ["forecastPrice", "预估售价"],
  ];

  scalarFields.forEach(([field, label]) => {
    if (before[field] !== after[field]) changes.push(label);
  });

  operationStageDefinitions.forEach(({ id, label }) => {
    const previous = before.stages.find((stage) => stage.id === id);
    const next = after.stages.find((stage) => stage.id === id);
    if (JSON.stringify(previous) !== JSON.stringify(next)) changes.push(label);
  });

  if (!changes.length) return "检查运营进度，无字段变更";
  const visible = changes.slice(0, 6).join("、");
  return changes.length > 6 ? `更新 ${visible} 等 ${changes.length} 项` : `更新 ${visible}`;
}

function createEmptyStage(id: ProductOperationStageId, owner: string): ProductOperationStage {
  return {
    id,
    status: "not_started",
    owner,
    plannedAt: "",
    completedAt: "",
    note: "",
    updatedAt: "",
  };
}
