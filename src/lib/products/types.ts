export type ProductStatus =
  | "pending"
  | "developing"
  | "ops_review"
  | "design_in_progress"
  | "listing_confirming"
  | "listed"
  | "canceled"
  | "delisted"
  | "patent_risk";

export type ProductSizeCm = {
  length: number;
  width: number;
  height: number;
};

export type ProductSourceWorkbookRow = {
  rowNumber: number;
  values: Record<string, string>;
};

export type ProductSourceImageAsset = {
  sourceUrl: string;
  assetUrl?: string;
  assetKey?: string;
  status: "pending" | "downloaded" | "failed" | "skipped";
  error?: string;
  downloadedAt?: string;
};

export type ProductSourceWorkbook = {
  kind: "commodity-create";
  importedFileName: string;
  importedAt: string;
  headersBySheet: Record<string, string[]>;
  rowsBySheet: Record<string, ProductSourceWorkbookRow[]>;
  mappedFields: string[];
  unmappedFields: string[];
  imageAssets?: ProductSourceImageAsset[];
};

export type ProductWorkflowStage =
  | "selection_pending"
  | "ops_confirming"
  | "design_in_progress"
  | "design_review"
  | "done"
  | "blocked";

export type ProductWorkflowRole = "selection" | "operations_supervisor" | "operations" | "designer";

export type ProductWorkflowEvent = {
  id: string;
  stage: ProductWorkflowStage;
  stageLabel: string;
  actorName?: string;
  assigneeName?: string;
  note?: string;
  createdAt: string;
};

export type ProductOperationStageId =
  | "selection_data"
  | "sample_confirmation"
  | "backend_upload"
  | "system_entry"
  | "order"
  | "image_request"
  | "copywriting"
  | "design"
  | "final_sample_confirmation"
  | "shipping"
  | "keyword_research"
  | "listing";

export type ProductOperationStageStatus = "not_started" | "in_progress" | "completed" | "blocked";

export type ProductOperationStage = {
  id: ProductOperationStageId;
  status: ProductOperationStageStatus;
  owner: string;
  plannedAt: string;
  completedAt: string;
  note: string;
  updatedAt: string;
};

export type ProductOperationProgressEvent = {
  id: string;
  changedAt: string;
  changedBy: string;
  summary: string;
};

export type ProductOperationProgress = {
  selectionDate: string;
  orderQuantity: number;
  orderDate: string;
  shipDate: string;
  dailyAdBudget: number;
  forecastMonthlySales: number;
  forecastPrice: number;
  stages: ProductOperationStage[];
  updatedAt: string;
  updatedBy: string;
  history: ProductOperationProgressEvent[];
};

export type Product = {
  id: string;
  sku: string;
  chineseName: string;
  englishName: string;
  asin: string;
  developer: string;
  purchasePrice: number;
  status: ProductStatus;
  supplierName: string;
  supplierUrl: string;
  specs: string;
  purchaseLeadTime: string;
  createdAt: string;
  keywords: string;
  note: string;
  cancelReason: string;
  hsCode: string;
  images: string[];
  competitorAsins: string[];
  productWeightG: number;
  packageWeightG: number;
  productSizeCm: ProductSizeCm;
  packageSizeCm: ProductSizeCm;
  selectionOwner?: string;
  opsAssignee?: string;
  opsAssignees?: string[];
  designerAssignee?: string;
  designerAssignees?: string[];
  editableBy?: string[];
  viewableBy?: string[];
  workflowStage?: ProductWorkflowStage;
  workflowStartedAt?: string;
  workflowDueAt?: string;
  workflowUpdatedAt?: string;
  workflowReminderAt?: string;
  workflowHistory?: ProductWorkflowEvent[];
  operationsProgress?: ProductOperationProgress;
  sourceWorkbook?: ProductSourceWorkbook;
};

export type ProductDraft = Omit<Product, "id"> & {
  id?: string;
};
