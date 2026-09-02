import { randomUUID } from "node:crypto";
import { createProductListItem, createProductListWhere, splitMultiValue } from "@/lib/products/list-query";

export type ProductExportJobPayload = {
  search?: string;
  asin?: string;
  status?: string | null;
  supplierName?: string;
  opsAssignees?: string[];
  selectionOwners?: string[];
  designerAssignees?: string[];
  mySkuOwner?: string;
  minPrice?: number;
  maxPrice?: number;
};

const productExportHeaders = [
  "SKU",
  "中文名",
  "英文名",
  "状态",
  "当前负责人",
  "更新时间",
  "ASIN",
  "采购价格",
  "供应商名称",
  "选品负责人",
  "运营负责人",
  "美工负责人",
  "流程截止",
];

export function buildProductExportPayload(url: URL) {
  const status = url.searchParams.get("status");

  return {
    search: url.searchParams.get("search")?.trim() || undefined,
    asin: url.searchParams.get("asin")?.trim() || undefined,
    status: status === "all" ? null : status?.trim() || undefined,
    supplierName: url.searchParams.get("supplierName")?.trim() || undefined,
    opsAssignees: splitMultiValue(url.searchParams.get("opsAssignees")),
    selectionOwners: splitMultiValue(url.searchParams.get("selectionOwners")),
    designerAssignees: splitMultiValue(url.searchParams.get("designerAssignees")),
    mySkuOwner: url.searchParams.get("mySkuOwner")?.trim() || undefined,
    minPrice: parseOptionalNumber(url.searchParams.get("minPrice")),
    maxPrice: parseOptionalNumber(url.searchParams.get("maxPrice")),
  } satisfies ProductExportJobPayload;
}

export function normalizeProductExportPayload(value: unknown): ProductExportJobPayload {
  if (!value || typeof value !== "object") {
    return {};
  }

  const payload = value as Partial<ProductExportJobPayload>;

  return {
    search: typeof payload.search === "string" ? payload.search.trim() || undefined : undefined,
    asin: typeof payload.asin === "string" ? payload.asin.trim() || undefined : undefined,
    status: typeof payload.status === "string" ? payload.status.trim() || undefined : null,
    supplierName: typeof payload.supplierName === "string" ? payload.supplierName.trim() || undefined : undefined,
    opsAssignees: Array.isArray(payload.opsAssignees) ? payload.opsAssignees.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
    selectionOwners: Array.isArray(payload.selectionOwners) ? payload.selectionOwners.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
    designerAssignees: Array.isArray(payload.designerAssignees) ? payload.designerAssignees.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
    mySkuOwner: typeof payload.mySkuOwner === "string" ? payload.mySkuOwner.trim() || undefined : undefined,
    minPrice: normalizeNumber(payload.minPrice),
    maxPrice: normalizeNumber(payload.maxPrice),
  };
}

export function createProductExportFileName(now = new Date()) {
  return `products-${now.toISOString().slice(0, 10)}.csv`;
}

export function createProductExportStorageKey(now = new Date()) {
  return `exports/products/${now.toISOString().slice(0, 10)}/${randomUUID()}.csv`;
}

export function buildProductExportCsv(rows: Array<Record<string, string | number | null | undefined>>) {
  const lines = [
    productExportHeaders.map(csvEscape).join(","),
    ...rows.map((row) => productExportHeaders.map((header) => csvEscape(row[header])).join(",")),
  ];

  return `${lines.join("\n")}\n`;
}

export function buildProductExportRows(records: Array<Parameters<typeof createProductListItem>[0]>) {
  return records.map((record) => {
    const listItem = createProductListItem(record);

    return {
      SKU: listItem.sku,
      中文名: listItem.chineseName,
      英文名: listItem.englishName,
      状态: listItem.status,
      当前负责人: listItem.currentOwner,
      更新时间: listItem.updatedAt,
      ASIN: record.asin,
      采购价格: record.purchasePrice,
      供应商名称: record.supplierName,
      选品负责人: record.selectionOwner,
      运营负责人: record.opsAssignee,
      美工负责人: record.designerAssignee,
      流程截止: record.workflowDueAt?.toISOString() ?? "",
    };
  });
}

export function buildProductExportWhere(input: {
  user: { organizationId: string };
  workspaceId: string;
  payload: ProductExportJobPayload;
}) {
  return createProductListWhere({
    user: input.user,
    workspaceId: input.workspaceId,
    search: input.payload.search,
    asin: input.payload.asin,
    status: input.payload.status ?? undefined,
    supplierName: input.payload.supplierName,
    opsAssignees: input.payload.opsAssignees ?? [],
    selectionOwners: input.payload.selectionOwners ?? [],
    designerAssignees: input.payload.designerAssignees ?? [],
    mySkuOwner: input.payload.mySkuOwner,
    minPrice: input.payload.minPrice,
    maxPrice: input.payload.maxPrice,
  });
}

function parseOptionalNumber(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function csvEscape(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
