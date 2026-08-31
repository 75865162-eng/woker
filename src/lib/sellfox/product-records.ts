import type { Prisma } from "@prisma/client";
import type { Product } from "@/lib/products/types";
import { normalizeWorkflowStage } from "@/lib/products/list-query";
import { normalizeAssigneeList } from "@/lib/products/workflow";

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;
}

function text(record: RecordLike, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function number(record: RecordLike, ...keys: string[]) {
  const value = Number(text(record, ...keys));
  return Number.isFinite(value) ? value : 0;
}

export function isSellfoxLegacyProductRecord(record: {
  id: string;
  payload: Prisma.JsonValue;
}) {
  const payload = asRecord(record.payload);
  return record.id.toLowerCase().startsWith("sellfox-") || text(payload ?? {}, "note").includes("赛狐在线产品 API");
}

export function productFromSellfoxApiRow(record: RecordLike): Product | null {
  const sku = text(record, "sku", "msku", "sellerSku", "merchantSku");
  if (!sku) return null;

  const now = new Date().toISOString();

  return {
    id: `sellfox-${sku}`,
    sku,
    chineseName: text(record, "commodityName", "productName", "name"),
    englishName: text(record, "title", "productTitle", "name"),
    asin: text(record, "asin", "childAsin"),
    developer: text(record, "developer", "developerName"),
    purchasePrice: number(record, "purchasePrice", "cost"),
    status: text(record, "onlineStatus", "status") === "active" ? "listed" : "pending",
    supplierName: "",
    supplierUrl: "",
    specs: "",
    purchaseLeadTime: "",
    createdAt: text(record, "createTime", "createdAt") || now,
    keywords: "",
    note: "由赛狐在线产品 API 只读同步。",
    cancelReason: "",
    hsCode: "",
    images: [],
    competitorAsins: [],
    productWeightG: 0,
    packageWeightG: 0,
    productSizeCm: { length: 0, width: 0, height: 0 },
    packageSizeCm: { length: 0, width: 0, height: 0 },
    selectionOwner: text(record, "developer", "developerName"),
    opsAssignee: "",
    designerAssignee: "",
  };
}

export function sellfoxProductUpsertData(product: Product, user: { id: string }, scope: { workspaceId: string; accountId: string; marketplace: string }) {
  return {
    userId: user.id,
    workspaceId: scope.workspaceId,
    accountId: scope.accountId,
    marketplace: scope.marketplace,
    payload: product as unknown as Prisma.InputJsonValue,
    chineseName: product.chineseName,
    englishName: product.englishName,
    asin: product.asin,
    status: product.status,
    supplierName: product.supplierName,
    purchasePrice: product.purchasePrice,
    selectionOwner: product.selectionOwner || product.developer || "",
    opsAssignee: product.opsAssignee || normalizeAssigneeList(undefined, product.opsAssignees).join("、"),
    designerAssignee: product.designerAssignee || normalizeAssigneeList(undefined, product.designerAssignees).join("、"),
    workflowStage: product.workflowStage ?? "",
    workflowDueAt: product.workflowDueAt ? new Date(product.workflowDueAt) : null,
    operationsProgressIncomplete: false,
  };
}

export function sellfoxProductRecordToProduct(record: {
  id: string;
  sku: string;
  chineseName: string;
  englishName: string;
  asin: string;
  status: string;
  supplierName: string;
  purchasePrice: number;
  selectionOwner: string;
  opsAssignee: string;
  designerAssignee: string;
  workflowStage: string;
  createdAt: Date;
  updatedAt: Date;
  payload: Prisma.JsonValue;
}): Product {
  const payload = asRecord(record.payload);
  return {
    id: record.id,
    sku: record.sku,
    chineseName: record.chineseName,
    englishName: record.englishName,
    asin: record.asin,
    developer: text(payload ?? {}, "developer", "developerName"),
    purchasePrice: record.purchasePrice,
    status: record.status as Product["status"],
    supplierName: record.supplierName,
    supplierUrl: text(payload ?? {}, "supplierUrl"),
    specs: text(payload ?? {}, "specs"),
    purchaseLeadTime: text(payload ?? {}, "purchaseLeadTime"),
    createdAt: record.createdAt.toISOString(),
    keywords: text(payload ?? {}, "keywords"),
    note: text(payload ?? {}, "note"),
    cancelReason: text(payload ?? {}, "cancelReason"),
    hsCode: text(payload ?? {}, "hsCode"),
    images: Array.isArray(payload?.images) ? payload.images.filter((item): item is string => typeof item === "string") : [],
    competitorAsins: Array.isArray(payload?.competitorAsins) ? payload.competitorAsins.filter((item): item is string => typeof item === "string") : [],
    productWeightG: Number(payload?.productWeightG) || 0,
    packageWeightG: Number(payload?.packageWeightG) || 0,
    productSizeCm: {
      length: Number(asRecord(payload?.productSizeCm)?.length) || 0,
      width: Number(asRecord(payload?.productSizeCm)?.width) || 0,
      height: Number(asRecord(payload?.productSizeCm)?.height) || 0,
    },
    packageSizeCm: {
      length: Number(asRecord(payload?.packageSizeCm)?.length) || 0,
      width: Number(asRecord(payload?.packageSizeCm)?.width) || 0,
      height: Number(asRecord(payload?.packageSizeCm)?.height) || 0,
    },
    selectionOwner: record.selectionOwner,
    opsAssignee: record.opsAssignee,
    designerAssignee: record.designerAssignee,
    workflowStage: normalizeWorkflowStage(record.workflowStage) ?? undefined,
    workflowDueAt: undefined,
  };
}
