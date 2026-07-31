export type ProductStatus =
  | "pending"
  | "developing"
  | "ops_review"
  | "design_in_progress"
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
};

export type ProductDraft = Omit<Product, "id"> & {
  id?: string;
};
