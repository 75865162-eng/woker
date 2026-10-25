import { randomUUID } from "node:crypto";
import type { Product, ProductSizeCm, ProductStatus } from "@/lib/products/types";
import { validateFields } from "./validation";

export type ErpDraft = Record<string, unknown>;

export type NormalizedDraft = {
  version: 1;
  sku: string;
  workspaceId: string;
  accountId: string;
  marketplace: string;
  product: Product;
  providedProductKeys: string[];
  imagePaths: string[];
  warnings: string[];
};

const productKeys = new Set([
  "id", "revision", "sku", "chineseName", "englishName", "image", "imageFileId", "asin", "developer",
  "purchasePrice", "status", "source", "supplierName", "supplierUrl", "specs", "purchaseLeadTime", "createdAt",
  "keywords", "note", "cancelReason", "hsCode", "images", "imageAssets", "competitorAsins", "productWeightG",
  "packageWeightG", "productSizeCm", "packageSizeCm", "selectionOwner", "opsAssignee", "opsAssignees",
  "designerAssignee", "designerAssignees", "editableBy", "viewableBy", "workflowStage", "workflowStartedAt",
  "workflowDueAt", "workflowUpdatedAt", "workflowReminderAt", "workflowHistory", "currentOwner", "isOverdue",
  "operationsProgress", "conclusionExcelFile", "patentInformation", "videoPlan", "meta",
]);

const topLevelKeys = new Set(["version", "sku", "title", "品名", "chineseName", "englishName", "marketplace", "workspace", "workspaceId", "accountId", "imagePaths", "meta", ...productKeys]);
const statuses = new Set<ProductStatus>(["pending", "developing", "ops_review", "design_in_progress", "listing_confirming", "listed", "canceled", "delisted", "patent_risk"]);

function nonEmptyString(value: unknown, field: string, errors: string[]) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${field} must be a non-empty string`);
  return typeof value === "string" ? value.trim() : "";
}

function size(value: unknown, field: string, errors: string[]): ProductSizeCm {
  if (value === undefined) return { length: 0, width: 0, height: 0 };
  if (!value || typeof value !== "object") { errors.push(`${field} must be an object`); return { length: 0, width: 0, height: 0 }; }
  const row = value as Record<string, unknown>;
  const result = { length: Number(row.length ?? 0), width: Number(row.width ?? 0), height: Number(row.height ?? 0) };
  if (Object.values(result).some((item) => !Number.isFinite(item) || item < 0)) errors.push(`${field} dimensions must be non-negative numbers`);
  return result;
}

export function normalizeDraft(input: unknown): { draft?: NormalizedDraft; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: ["draft must be a JSON object"] };
  const raw = input as ErpDraft;
  if (raw.fixture === true || (raw.meta && typeof raw.meta === "object" && (raw.meta as Record<string, unknown>).fixture === true)) errors.push("FIXTURE_WRITE_FORBIDDEN");
  validateFields(raw, errors);
  for (const key of Object.keys(raw)) if (!topLevelKeys.has(key)) errors.push(`unknown field: ${key}`);
  if (raw.version !== 1) errors.push("version must be 1");
  const sku = nonEmptyString(raw.sku, "sku", errors);
  const workspaceId = nonEmptyString(raw.workspaceId ?? raw.workspace, "workspace", errors);
  if (raw.workspace !== undefined && raw.workspaceId !== undefined && raw.workspace !== raw.workspaceId) errors.push("workspace and workspaceId must match when both are provided");
  const marketplace = nonEmptyString(raw.marketplace, "marketplace", errors);
  const title = raw.chineseName ?? raw.title ?? raw["品名"];
  const chineseName = nonEmptyString(title, "title/品名", errors);
  const imagePathsValue = raw.imagePaths === undefined ? [] : raw.imagePaths;
  if (!Array.isArray(imagePathsValue) || imagePathsValue.some((item) => typeof item !== "string" || !item.trim())) errors.push("imagePaths must be an array of strings");
  const meta = raw.meta === undefined ? {} : raw.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) errors.push("meta must be an object");
  if (raw.status !== undefined && !statuses.has(raw.status as ProductStatus)) errors.push("status is not a supported ProductStatus");
  if (errors.length) return { errors };
  const imagePaths = imagePathsValue as string[];

  const product = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : randomUUID(),
    revision: typeof raw.revision === "number" ? raw.revision : undefined,
    sku,
    chineseName,
    englishName: typeof raw.englishName === "string" ? raw.englishName.trim() : "",
    image: typeof raw.image === "string" ? raw.image : undefined,
    imageFileId: typeof raw.imageFileId === "string" ? raw.imageFileId : undefined,
    asin: typeof raw.asin === "string" ? raw.asin.trim() : "",
    developer: typeof raw.developer === "string" ? raw.developer.trim() : "",
    purchasePrice: typeof raw.purchasePrice === "number" && Number.isFinite(raw.purchasePrice) ? raw.purchasePrice : 0,
    status: statuses.has(raw.status as ProductStatus) ? raw.status as ProductStatus : "pending",
    source: "dashboard" as const,
    supplierName: typeof raw.supplierName === "string" ? raw.supplierName : "",
    supplierUrl: typeof raw.supplierUrl === "string" ? raw.supplierUrl : "",
    specs: typeof raw.specs === "string" ? raw.specs : "",
    purchaseLeadTime: typeof raw.purchaseLeadTime === "string" ? raw.purchaseLeadTime : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    keywords: typeof raw.keywords === "string" ? raw.keywords : "",
    note: typeof raw.note === "string" ? raw.note : "",
    cancelReason: typeof raw.cancelReason === "string" ? raw.cancelReason : "",
    hsCode: typeof raw.hsCode === "string" ? raw.hsCode : "",
    images: Array.isArray(raw.images) && raw.images.every((item) => typeof item === "string") ? raw.images as string[] : [],
    imageAssets: raw.imageAssets as Product["imageAssets"],
    competitorAsins: Array.isArray(raw.competitorAsins) && raw.competitorAsins.every((item) => typeof item === "string") ? raw.competitorAsins as string[] : [],
    productWeightG: typeof raw.productWeightG === "number" ? raw.productWeightG : 0,
    packageWeightG: typeof raw.packageWeightG === "number" ? raw.packageWeightG : 0,
    productSizeCm: size(raw.productSizeCm, "productSizeCm", errors),
    packageSizeCm: size(raw.packageSizeCm, "packageSizeCm", errors),
    selectionOwner: typeof raw.selectionOwner === "string" ? raw.selectionOwner : "",
    opsAssignee: typeof raw.opsAssignee === "string" ? raw.opsAssignee : "",
    opsAssignees: Array.isArray(raw.opsAssignees) ? raw.opsAssignees as string[] : [],
    designerAssignee: typeof raw.designerAssignee === "string" ? raw.designerAssignee : "",
    designerAssignees: Array.isArray(raw.designerAssignees) ? raw.designerAssignees as string[] : [],
    editableBy: Array.isArray(raw.editableBy) ? raw.editableBy as string[] : [],
    viewableBy: Array.isArray(raw.viewableBy) ? raw.viewableBy as string[] : [],
    workflowStage: raw.workflowStage as Product["workflowStage"],
    workflowStartedAt: raw.workflowStartedAt as string | undefined,
    workflowDueAt: raw.workflowDueAt as string | undefined,
    workflowUpdatedAt: raw.workflowUpdatedAt as string | undefined,
    workflowReminderAt: raw.workflowReminderAt as string | undefined,
    workflowHistory: raw.workflowHistory as Product["workflowHistory"],
    currentOwner: typeof raw.currentOwner === "string" ? raw.currentOwner : "",
    isOverdue: typeof raw.isOverdue === "boolean" ? raw.isOverdue : false,
    operationsProgress: raw.operationsProgress as Product["operationsProgress"],
    conclusionExcelFile: raw.conclusionExcelFile as Product["conclusionExcelFile"],
    patentInformation: raw.patentInformation as Product["patentInformation"],
    videoPlan: raw.videoPlan as Product["videoPlan"],
    meta: meta as Record<string, unknown>,
  } as Product;
  if (errors.length) return { errors };
  const warnings = imagePaths.length ? ["IMAGES_NEED_UPLOAD"] : [];
  const providedProductKeys = Object.keys(raw).filter((key) => productKeys.has(key));
  if (raw.title !== undefined || raw["品名"] !== undefined) providedProductKeys.push("chineseName");
  return { draft: { version: 1, sku, workspaceId, accountId: typeof raw.accountId === "string" ? raw.accountId.trim() : "", marketplace, product, providedProductKeys: [...new Set(providedProductKeys)], imagePaths, warnings }, errors };
}
