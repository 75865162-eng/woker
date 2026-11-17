"use client";

import { stripAmazonProductObservations } from "@/lib/products/amazon-field-policy";
import type { Product, ProductListItem } from "@/lib/products/types";
import { toLightweightProduct } from "@/lib/products/lightweight-product";
import { initialFilters, type ProductFilters, type TrialProductDraft } from "./product-workbench-model";
import { defaultProductListSort, type ProductListSort } from "@/lib/products/list-sort";

export type ProductWorkbenchCache = {
  products: Product[];
  filters: ProductFilters;
  page: number;
  pageSize: number;
  totalCount: number;
  summary: ProductListSummary;
};

export type ProductExportNotice = {
  tone: "info" | "success" | "error";
  message: string;
  jobId?: string;
};

export const productWorkbenchStorageKeyPrefix = "amazon-product-workbench-cache-v4";

let productWorkbenchCache: ProductWorkbenchCache | null = null;

let productWorkbenchCacheWorkspaceId: string | null = null;

export const productDetailCache = new Map<string, Product>();

export const productDetailInflight = new Map<string, Promise<Product>>();

export const productSummaryResponseCache = new Map<string, { cachedAt: number; data: { summary?: ProductListSummary; error?: string } }>();

export const productSummaryInflight = new Map<string, Promise<{ summary?: ProductListSummary; error?: string }>>();

export const REQUEST_CACHE_TTL_MS = 30_000;

export const compactToolbarButtonClass =
  "shrink-0 whitespace-nowrap max-sm:h-7 max-sm:px-2 max-sm:text-label max-sm:leading-none max-sm:gap-1";

export type ProductListSummary = {
  total: number;
  developing: number;
  opsReview: number;
  designInProgress: number;
  operationsProgress: number;
  overdue: number;
};

export type ProductWorkbenchInitialData = {
  workspaceId: string;
  products: ProductListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
  summary: ProductListSummary;
};

export const emptyProductListSummary: ProductListSummary = {
  total: 0,
  developing: 0,
  opsReview: 0,
  designInProgress: 0,
  operationsProgress: 0,
  overdue: 0,
};

export function getProductExportNoticeClass(tone: ProductExportNotice["tone"]) {
  if (tone === "success") {
    return "border-success/30 bg-success-soft text-success-ink";
  }
  if (tone === "error") {
    return "border-danger/30 bg-danger-soft text-danger-ink";
  }

  return "border-info/30 bg-info-soft text-info-ink";
}

export function normalizeProductFilters(filters?: Partial<ProductFilters> | null): ProductFilters {
  return {
    ...initialFilters,
    ...(filters ?? {}),
    keyword: filters?.keyword ?? "",
    asin: filters?.asin ?? "",
    opsAssignees: Array.isArray(filters?.opsAssignees) ? filters!.opsAssignees : [],
    selectionOwners: Array.isArray(filters?.selectionOwners) ? filters!.selectionOwners : [],
    designerAssignees: Array.isArray(filters?.designerAssignees) ? filters!.designerAssignees : [],
    mySkuOwner: filters?.mySkuOwner ?? "",
    supplierName: filters?.supplierName ?? "",
    status: filters?.status ?? "all",
    minPrice: filters?.minPrice ?? "",
    maxPrice: filters?.maxPrice ?? "",
  };
}

export function hasActiveProductListFilters(filters: ProductFilters) {
  return Boolean(
    filters.keyword.trim()
      || filters.asin.trim()
      || filters.supplierName.trim()
      || filters.opsAssignees.length
      || filters.selectionOwners.length
      || filters.designerAssignees.length
      || filters.mySkuOwner.trim()
      || filters.minPrice.trim()
      || filters.maxPrice.trim()
      || filters.status !== "all",
  );
}

export function readCurrentWorkspaceId() {
  if (typeof window === "undefined") {
    return "default";
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}") as { workspaceId?: string };
    return parsed.workspaceId?.trim() || "default";
  } catch {
    return "default";
  }
}

export function getProductWorkbenchStorageKey(workspaceId: string) {
  return `${productWorkbenchStorageKeyPrefix}:${workspaceId || "default"}`;
}

export function getProductListRequestCacheKey(input: {
  filters: ProductFilters;
  page: number;
  pageSize: number;
  sort?: ProductListSort;
  includeSummary?: boolean;
  detail?: boolean;
  sellerAccountId?: string;
}) {
  const params = new URLSearchParams({
    workspaceId: readCurrentWorkspaceId(),
    ...(input.sellerAccountId ? { sellerAccountId: input.sellerAccountId } : {}),
    page: String(input.page),
    pageSize: String(input.pageSize),
    sortBy: (input.sort ?? defaultProductListSort).field,
    sortDirection: (input.sort ?? defaultProductListSort).direction,
    detail: "list",
    includeSummary: input.includeSummary === false ? "false" : "true",
  });

  if (input.filters.keyword.trim()) params.set("search", input.filters.keyword.trim());
  if (input.filters.asin.trim()) params.set("asin", input.filters.asin.trim());
  if (input.filters.supplierName.trim()) params.set("supplierName", input.filters.supplierName.trim());
  if (input.filters.status !== "all") params.set("status", input.filters.status);
  if (input.filters.opsAssignees.length) params.set("opsAssignees", input.filters.opsAssignees.join(","));
  if (input.filters.selectionOwners.length) params.set("selectionOwners", input.filters.selectionOwners.join(","));
  if (input.filters.designerAssignees.length) params.set("designerAssignees", input.filters.designerAssignees.join(","));
  if (input.filters.mySkuOwner.trim()) params.set("mySkuOwner", input.filters.mySkuOwner.trim());
  if (input.filters.minPrice.trim()) params.set("minPrice", input.filters.minPrice.trim());
  if (input.filters.maxPrice.trim()) params.set("maxPrice", input.filters.maxPrice.trim());

  return `${readCurrentWorkspaceId()}::${params.toString()}`;
}

export function getProductSummaryRequestCacheKey() {
  return `${readCurrentWorkspaceId()}::summary`;
}

export function invalidateProductRequestCaches() {
  productSummaryResponseCache.clear();
  productSummaryInflight.clear();
}

export function scheduleNonCriticalTask(callback: () => void, timeout = 1500) {
  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(callback, { timeout });

    return () => window.cancelIdleCallback(idleId);
  }

  const timer = window.setTimeout(callback, Math.min(timeout, 500));
  return () => window.clearTimeout(timer);
}

export function getProductDetailCacheKey(workspaceId: string, sku: string) {
  return `${workspaceId || "default"}:${sku.trim()}`;
}

export function getProductDetailCacheKeyWithMode(workspaceId: string, sku: string, includeWorkbookImages: boolean) {
  return `${getProductDetailCacheKey(workspaceId, sku)}:${includeWorkbookImages ? "full" : "text"}`;
}

export function hasWorkbookDetail(product: Product) {
  return Boolean((product as Product & { workbookDetail?: TrialProductDraft }).workbookDetail);
}

export function writeCachedProductWorkbench(cache: ProductWorkbenchCache) {
  cache = { ...cache, products: cache.products.map(stripAmazonProductObservations) };
  productWorkbenchCache = cache;
  productWorkbenchCacheWorkspaceId = readCurrentWorkspaceId();
  for (const product of cache.products) {
    if (hasWorkbookDetail(product)) {
      productDetailCache.set(getProductDetailCacheKeyWithMode(productWorkbenchCacheWorkspaceId, product.sku, true), product);
    }
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getProductWorkbenchStorageKey(readCurrentWorkspaceId()), JSON.stringify(cache));
  } catch {
    // 仅作尽力恢复缓存，不影响权威保存。
  }
}

export function readCachedProductWorkbench() {
  const workspaceId = readCurrentWorkspaceId();

  if (productWorkbenchCache && productWorkbenchCacheWorkspaceId === workspaceId) {
    return { ...productWorkbenchCache, products: productWorkbenchCache.products.map(stripAmazonProductObservations) };
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getProductWorkbenchStorageKey(readCurrentWorkspaceId()));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as ProductWorkbenchCache;
    if (!Array.isArray(parsed.products)) {
      return null;
    }

    const lightweightProducts = parsed.products.map((product) => stripAmazonProductObservations(toLightweightProduct(product)));
    for (const product of lightweightProducts) {
      if (hasWorkbookDetail(product)) {
        productDetailCache.set(getProductDetailCacheKeyWithMode(workspaceId, product.sku, true), product);
      }
    }
    const nextCache = {
      ...parsed,
      products: lightweightProducts,
      filters: normalizeProductFilters(parsed.filters),
    };
    productWorkbenchCache = nextCache;
    productWorkbenchCacheWorkspaceId = workspaceId;
    return nextCache;
  } catch {
    return null;
  }
}
