import type { ProductVideoPlanDraft } from "@/lib/products/video-plan";

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
  | "backend_upload"
  | "order"
  | "image_request"
  | "copywriting"
  | "design"
  | "final_sample_confirmation"
  | "shipping"
  | "keyword_research"
  | "listing";

export type ProductOperationStageStatus = "not_started" | "in_progress" | "completed" | "blocked";

export type ProductOperationStageEvidence = {
  fileName: string;
  fileType: string;
  fileDataUrl: string;
  uploadedAt: string;
};

export type ProductOperationStage = {
  id: ProductOperationStageId;
  status: ProductOperationStageStatus;
  owner: string;
  plannedAt: string;
  completedAt: string;
  note: string;
  updatedAt: string;
  evidenceFile?: ProductOperationStageEvidence;
};

export type ProductOperationProgressEvent = {
  id: string;
  changedAt: string;
  changedBy: string;
  summary: string;
};

export type ProductOperationProgress = {
  orderQuantity: number;
  shipDate: string;
  forecastMonthlySales: number;
  forecastPrice: number;
  stages: ProductOperationStage[];
  updatedAt: string;
  updatedBy: string;
  history: ProductOperationProgressEvent[];
};

export type ProductFileAsset = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storageType: "local" | "s3" | "r2";
  uploadedAt: string;
  downloadUrl: string;
};

export type ProductImageAsset = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storageType: "local" | "s3" | "r2";
  uploadedAt: string;
  thumbUrl: string;
  originalUrl: string;
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
  source?: "dashboard" | "sellfox";
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
  imageAssets?: ProductImageAsset[];
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
  currentOwner?: string;
  isOverdue?: boolean;
  operationsProgress?: ProductOperationProgress;
  conclusionExcelFile?: ProductFileAsset;
  videoPlan?: ProductVideoPlanDraft;
};

export type ProductDraft = Omit<Product, "id"> & {
  id?: string;
};

export type ProductListItem = {
  id: string;
  sku: string;
  chineseName: string;
  englishName: string;
  image?: string;
  asin?: string;
  status: ProductStatus;
  currentOwner: string;
  isOverdue?: boolean;
  updatedAt: string;
  createdAt?: string;
  purchasePrice?: number;
  supplierName?: string;
  specs?: string;
  keywords?: string;
  note?: string;
  selectionOwner?: string;
  opsAssignee?: string;
  designerAssignee?: string;
  workflowStage?: ProductWorkflowStage;
  workflowDueAt?: string;
};

export type ProductListSummary = {
  total: number;
  developing: number;
  opsReview: number;
  designInProgress: number;
  operationsProgress: number;
  overdue: number;
};
