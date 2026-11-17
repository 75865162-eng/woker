import { Prisma } from "@prisma/client";
import type { Product, ProductListItem } from "@/lib/products/types";
import {
  createProductListItem,
  hasStandardProductStatus,
  type ProductListSource,
} from "@/lib/products/list-query";

export type ProductListResponse = {
  products: Array<Product | ProductListItem>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
  summary?: {
    total: number;
    developing: number;
    opsReview: number;
    designInProgress: number;
    operationsProgress: number;
    overdue: number;
  };
};

export function clampPageSize(value: string | null) {
  const pageSize = Number(value) || 50;
  return Math.min(Math.max(pageSize, 1), 200);
}

export function parseOptionalNumber(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

export function buildProductListWhereSql(input: {
  organizationId: string;
  workspaceId: string;
  source: ProductListSource;
  search?: string;
  asin?: string;
  status?: string | null;
  supplierName?: string;
  opsAssignees: string[];
  selectionOwners: string[];
  designerAssignees: string[];
  mySkuOwner?: string;
  createdByUserId?: string;
  minPrice?: number;
  maxPrice?: number;
}) {
  const field = (name: string) => Prisma.sql`COALESCE(s."${Prisma.raw(name)}", r."${Prisma.raw(name)}")`;
  const conditions: Prisma.Sql[] = [
    Prisma.sql`r."organizationId" = ${input.organizationId}`,
    Prisma.sql`r."workspaceId" = ${input.workspaceId}`,
  ];

  if (input.source === "dashboard") {
    conditions.push(Prisma.sql`r."source" = ${input.source}`);
  }

  if (input.search) {
    const search = `%${input.search}%`;
    conditions.push(Prisma.sql`
      (
        ${field("sku")} ILIKE ${search}
        OR r."id" ILIKE ${search}
        OR ${field("chineseName")} ILIKE ${search}
        OR ${field("englishName")} ILIKE ${search}
        OR COALESCE(t."keywords", r."payload"->>'keywords', '') ILIKE ${search}
      )
    `);
  }

  if (input.asin) {
    conditions.push(Prisma.sql`${field("asin")} ILIKE ${`%${input.asin}%`}`);
  }

  if (input.supplierName) {
    conditions.push(Prisma.sql`${field("supplierName")} ILIKE ${`%${input.supplierName}%`}`);
  }

  if (input.opsAssignees.length) {
    conditions.push(Prisma.sql`(${Prisma.join(
      input.opsAssignees.map((assignee) => Prisma.sql`${field("opsAssignee")} ILIKE ${`%${assignee}%`}`),
      " OR ",
    )})`);
  }

  if (input.selectionOwners.length) {
    conditions.push(Prisma.sql`${field("selectionOwner")} IN (${Prisma.join(input.selectionOwners)})`);
  }

  if (input.designerAssignees.length) {
    conditions.push(Prisma.sql`(${Prisma.join(
      input.designerAssignees.map((assignee) => Prisma.sql`${field("designerAssignee")} ILIKE ${`%${assignee}%`}`),
      " OR ",
    )})`);
  }

  if (input.mySkuOwner) {
    const ownerSearch = `%${input.mySkuOwner}%`;
    conditions.push(Prisma.sql`
      (
        ${field("selectionOwner")} ILIKE ${ownerSearch}
        OR ${field("currentOwner")} ILIKE ${ownerSearch}
        OR ${field("opsAssignee")} ILIKE ${ownerSearch}
        OR ${field("designerAssignee")} ILIKE ${ownerSearch}
        OR COALESCE(r."payload"->>'selectionOwner', '') ILIKE ${ownerSearch}
        OR COALESCE(r."payload"->>'currentOwner', '') ILIKE ${ownerSearch}
        OR COALESCE(r."payload"->>'opsAssignee', '') ILIKE ${ownerSearch}
        OR COALESCE(r."payload"->>'designerAssignee', '') ILIKE ${ownerSearch}
        OR COALESCE(r."payload"->'opsAssignees', '[]'::jsonb)::text ILIKE ${ownerSearch}
        OR COALESCE(r."payload"->'designerAssignees', '[]'::jsonb)::text ILIKE ${ownerSearch}
      )
    `);
  }

  if (input.createdByUserId) {
    conditions.push(Prisma.sql`r."userId" = ${input.createdByUserId}`);
  }

  if (Number.isFinite(input.minPrice) || Number.isFinite(input.maxPrice)) {
    conditions.push(
      Prisma.sql`${field("purchasePrice")} >= ${Number.isFinite(input.minPrice) ? input.minPrice : 0}`,
      Prisma.sql`${field("purchasePrice")} <= ${Number.isFinite(input.maxPrice) ? input.maxPrice : Number.MAX_SAFE_INTEGER}`,
    );
  }

  if (input.status === "operations_progress") {
    conditions.push(Prisma.sql`COALESCE(s."operationsProgressIncomplete", r."operationsProgressIncomplete") = true`);
  } else if (input.status === "development_phase") {
    conditions.push(Prisma.sql`${field("status")} IN ('pending', 'developing')`);
  } else if (input.status === "overdue") {
    conditions.push(Prisma.sql`${field("status")} NOT IN ('listed', 'canceled', 'delisted', 'patent_risk')`);
    conditions.push(Prisma.sql`
      (
        (${field("workflowDueAt")} IS NOT NULL AND ${field("workflowDueAt")} < NOW())
        OR (${field("workflowDueAt")} IS NULL AND ${field("createdAt")} < NOW() - INTERVAL '3 days')
      )
    `);
  } else if (input.status && input.status !== "all" && hasStandardProductStatus(input.status)) {
    conditions.push(Prisma.sql`${field("status")} = ${input.status}`);
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

function toOptionalString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toOptionalImageUrl(value: unknown) {
  const imageUrl = toOptionalString(value);
  return imageUrl && !imageUrl.startsWith("data:") ? imageUrl : undefined;
}

function toOptionalDate(value: unknown) {
  if (value == null) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toOptionalNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  return undefined;
}

export function mapProductListRow(record: Record<string, unknown>): ProductListItem {
  return createProductListItem({
    id: String(record.id ?? ""),
    sku: String(record.sku ?? ""),
    chineseName: String(record.chineseName ?? ""),
    englishName: String(record.englishName ?? ""),
    image: toOptionalImageUrl(record.image),
    imageFileId: toOptionalString(record.imageFileId),
    asin: toOptionalString(record.asin),
    status: String(record.status ?? "pending"),
    selectionOwner: toOptionalString(record.selectionOwner) ?? "",
    opsAssignee: toOptionalString(record.opsAssignee) ?? "",
    designerAssignee: toOptionalString(record.designerAssignee) ?? "",
    currentOwner: toOptionalString(record.currentOwner) ?? "",
    workflowStage: toOptionalString(record.workflowStage) ?? "",
    createdAt: toOptionalDate(record.createdAt),
    updatedAt: toOptionalDate(record.updatedAt) ?? new Date(),
    purchasePrice: toOptionalNumber(record.purchasePrice),
    supplierName: toOptionalString(record.supplierName),
    specs: toOptionalString(record.specs),
    keywords: toOptionalString(record.keywords),
    note: toOptionalString(record.note),
    workflowDueAt: toOptionalDate(record.workflowDueAt),
    isOverdue: Boolean(record.isOverdue),
  });
}

export function normalizeProductListSource(value: string | null): ProductListSource {
  return value === "all" ? value : "dashboard";
}

export function roundDuration(ms: number) {
  return Math.round(ms * 10) / 10;
}

export function createServerTimingHeader(timings: Record<string, number>, totalMs: number) {
  return [
    ...Object.entries(timings).map(([name, duration]) => `${name};dur=${duration}`),
    `total;dur=${totalMs}`,
  ].join(", ");
}
