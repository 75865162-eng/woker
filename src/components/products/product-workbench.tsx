"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, ExternalLink, FileDown, FileUp, History, LoaderCircle, PackagePlus, Save, Video, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { newProductStatusOptions, productStatusOptions } from "@/data/products";
import {
  accountsToTeamMembers,
  type AccountRoleId,
  filterTeamMembersByRoles,
  type TeamAccountRecord,
  type TeamMember,
} from "@/lib/accounts/team-roster";
import type { Product, ProductDraft, ProductImageAsset, ProductListItem, ProductStatus, ProductWorkflowRole, ProductWorkflowStage } from "@/lib/products/types";
import {
  buildWorkflowEvent,
  createWorkflowDueAt,
  formatWorkflowDate,
  getCurrentWorkflowAssignee,
  getProductWorkflowStage,
  isProductWorkflowOverdue,
  formatAssigneeList,
  formatAssigneePreview,
  normalizeAssigneeList,
  productWorkflowStageLabels,
  productWorkflowStageTones,
} from "@/lib/products/workflow";
import { isOperationsProgressComplete } from "@/lib/products/operations-progress";
import { getProductAssetDownloadUrl } from "@/lib/products/image-assets";
import { toLightweightProduct } from "@/lib/products/lightweight-product";
import { PRODUCT_ATTACHMENT_MAX_BYTES, productAttachmentSizeError } from "@/lib/products/file-assets";

import {
  initialFilters,
  pageSizeOptions,
  type ProductEditorDraft,
  type ProductFilters,
  type TrialCompetitorRow,
  type TrialImprovement,
  type TrialImprovementCellKey,
  type TrialKeywordRow,
  type TrialPriceRow,
  type TrialProductDraft,
  type TrialSupplierRow,
} from "./product-workbench-model";
import {
  ProductWorkbookDetailSections,
  createEmptyImprovementRow,
  getImprovementRow,
} from "./product-workbook-detail-sections";
import { ProductVideoPlanModal } from "./product-video-plan-modal";
import { DecimalInput, LabeledInput } from "./product-workbench-fields";
import { ConclusionExcelField, MultiSelectField, ReadonlyField } from "./product-editor-fields";
import { ProductEditorImagePanel, ProductImagePreviewModal, type ProductImageUploadProgress } from "./product-editor-image-panel";
import { ActivityLogModal, ProductFiltersBar, ProductTable } from "./product-workbench-shell";
import { ProductOperationsProgress } from "./product-operations-progress";
import {
  buildAmazonLink,
  formatDateTime,
  nextSku as getNextSku,
} from "./product-workbench-utils";
import {
  parseProductWorkbookFile,
  productToDraft,
} from "./product-workbench-data";
import { fetchTeamAccountsCached } from "@/lib/workspace/workspace-api-cache";
import {
  selectProductImageFiles,
  uploadProductImageFile,
  uploadEmbeddedProductImages,
} from "./product-attachment-upload";
import { ProductVersionModal } from "./product-version-modal";
import { TrialProductEditor as ExtractedTrialProductEditor } from "./trial-product-editor";

type ProductWorkbenchCache = {
  products: Product[];
  filters: ProductFilters;
  page: number;
  pageSize: number;
  totalCount: number;
  summary: ProductListSummary;
};

type ProductExportNotice = {
  tone: "info" | "success" | "error";
  message: string;
  jobId?: string;
};

const productWorkbenchStorageKeyPrefix = "amazon-product-workbench-cache-v4";
let productWorkbenchCache: ProductWorkbenchCache | null = null;
let productWorkbenchCacheWorkspaceId: string | null = null;
const productDetailCache = new Map<string, Product>();
const productListResponseCache = new Map<string, { cachedAt: number; data: { products?: Array<Product | ProductListItem>; pagination?: { total?: number; pageCount?: number }; summary?: ProductListSummary; error?: string } }>();
const productListInflight = new Map<string, Promise<{ products?: Array<Product | ProductListItem>; pagination?: { total?: number; pageCount?: number }; summary?: ProductListSummary; error?: string }>>();
const productSummaryResponseCache = new Map<string, { cachedAt: number; data: { summary?: ProductListSummary; error?: string } }>();
const productSummaryInflight = new Map<string, Promise<{ summary?: ProductListSummary; error?: string }>>();
const REQUEST_CACHE_TTL_MS = 30_000;
const compactToolbarButtonClass =
  "shrink-0 whitespace-nowrap max-sm:h-7 max-sm:px-2 max-sm:text-[10px] max-sm:leading-none max-sm:gap-1";
type ProductListSummary = {
  total: number;
  developing: number;
  opsReview: number;
  designInProgress: number;
  operationsProgress: number;
  overdue: number;
};

type ProductWorkbenchInitialData = {
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

const emptyProductListSummary: ProductListSummary = {
  total: 0,
  developing: 0,
  opsReview: 0,
  designInProgress: 0,
  operationsProgress: 0,
  overdue: 0,
};

function getProductExportNoticeClass(tone: ProductExportNotice["tone"]) {
  if (tone === "success") {
    return "border-green-200 bg-green-50 text-green-700";
  }
  if (tone === "error") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  return "border-blue-200 bg-blue-50 text-blue-700";
}

function normalizeProductFilters(filters?: Partial<ProductFilters> | null): ProductFilters {
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

function hasActiveProductListFilters(filters: ProductFilters) {
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

function readCurrentWorkspaceId() {
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

function getProductWorkbenchStorageKey(workspaceId: string) {
  return `${productWorkbenchStorageKeyPrefix}:${workspaceId || "default"}`;
}

function getProductListRequestCacheKey(input: {
  filters: ProductFilters;
  page: number;
  pageSize: number;
  includeSummary?: boolean;
  detail?: boolean;
}) {
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
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
  if (input.filters.mySkuOwner.trim()) params.set("createdByMe", "true");
  if (input.filters.minPrice.trim()) params.set("minPrice", input.filters.minPrice.trim());
  if (input.filters.maxPrice.trim()) params.set("maxPrice", input.filters.maxPrice.trim());

  return `${readCurrentWorkspaceId()}::${params.toString()}`;
}

function getProductSummaryRequestCacheKey() {
  return `${readCurrentWorkspaceId()}::summary`;
}

function invalidateProductRequestCaches() {
  productListResponseCache.clear();
  productListInflight.clear();
  productSummaryResponseCache.clear();
  productSummaryInflight.clear();
}

function scheduleNonCriticalTask(callback: () => void, timeout = 1500) {
  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(callback, { timeout });

    return () => window.cancelIdleCallback(idleId);
  }

  const timer = window.setTimeout(callback, Math.min(timeout, 500));
  return () => window.clearTimeout(timer);
}

function getProductDetailCacheKey(workspaceId: string, sku: string) {
  return `${workspaceId || "default"}:${sku.trim()}`;
}

function getProductDetailCacheKeyWithMode(workspaceId: string, sku: string, includeWorkbookImages: boolean) {
  return `${getProductDetailCacheKey(workspaceId, sku)}:${includeWorkbookImages ? "full" : "text"}`;
}

function hasWorkbookDetail(product: Product) {
  return Boolean((product as Product & { workbookDetail?: TrialProductDraft }).workbookDetail);
}

function readCachedProductWorkbench() {
  const workspaceId = readCurrentWorkspaceId();

  if (productWorkbenchCache && productWorkbenchCacheWorkspaceId === workspaceId) {
    return productWorkbenchCache;
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

    const lightweightProducts = parsed.products.map((product) => toLightweightProduct(product));
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

function writeCachedProductWorkbench(cache: ProductWorkbenchCache) {
  productWorkbenchCache = cache;
  productWorkbenchCacheWorkspaceId = readCurrentWorkspaceId();
  for (const product of cache.products) {
    if (hasWorkbookDetail(product)) {
      productDetailCache.set(getProductDetailCacheKeyWithMode(productWorkbenchCacheWorkspaceId, product.sku, true), product);
    }
  }

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getProductWorkbenchStorageKey(readCurrentWorkspaceId()), JSON.stringify(cache));
  } catch {
    // Best effort only.
  }
}

export function ProductWorkbench({ initialData }: { initialData?: ProductWorkbenchInitialData }) {
  const initialCachedWorkbench = readCachedProductWorkbench();
  const hasServerInitialData = Boolean(
    initialData
      && (typeof window === "undefined" || readCurrentWorkspaceId() === initialData.workspaceId),
  );
  const [products, setProducts] = useState<Product[]>(() => (
    hasServerInitialData ? (initialData?.products as unknown as Product[]) : initialCachedWorkbench?.products ?? []
  ));
  const [, setTrialProducts] = useState<TrialProductDraft[]>([]);
  const [filters, setFilters] = useState<ProductFilters>(() => (
    hasServerInitialData ? normalizeProductFilters() : normalizeProductFilters(initialCachedWorkbench?.filters)
  ));
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [detailReady, setDetailReady] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isTrialEditorOpen, setIsTrialEditorOpen] = useState(false);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [versionProduct, setVersionProduct] = useState<Product | null>(null);
  const [page, setPage] = useState(() => (hasServerInitialData ? initialData?.pagination.page : initialCachedWorkbench?.page) ?? 1);
  const [pageSize, setPageSize] = useState(() => (hasServerInitialData ? initialData?.pagination.pageSize : initialCachedWorkbench?.pageSize) ?? 20);
  const [productsTotalCount, setProductsTotalCount] = useState(() => (
    hasServerInitialData ? initialData?.pagination.total : initialCachedWorkbench?.totalCount
  ) ?? 0);
  const [listSummary, setListSummary] = useState<ProductListSummary>(() => (
    hasServerInitialData ? initialData?.summary : initialCachedWorkbench?.summary
  ) ?? emptyProductListSummary);
  const [summaryReady, setSummaryReady] = useState(() => Boolean((hasServerInitialData && initialData) || initialCachedWorkbench));
  const [mySkuCount, setMySkuCount] = useState(0);
  const [mySkuReady, setMySkuReady] = useState(false);
  const [activityLog, setActivityLog] = useState<string[]>(["产品工作台已连接数据库"]);
  const [exportingProducts, setExportingProducts] = useState(false);
  const [exportNotice, setExportNotice] = useState<ProductExportNotice | null>(null);
  const [productsLoading, setProductsLoading] = useState(() => !hasServerInitialData && !initialCachedWorkbench);
  const [productsError, setProductsError] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const exportPollingJobsRef = useRef(new Set<string>());
  const exportPollingTimersRef = useRef(new Map<string, number>());
  const productsRequestSeq = useRef(0);
  const summaryRequestSeq = useRef(0);
  const productDetailRequestSeq = useRef(0);
  const initialDataConsumedRef = useRef(false);
  const previousFiltersRef = useRef<ProductFilters | null>(null);
  const previousPageRef = useRef<number | null>(null);
  const previousPageSizeRef = useRef<number | null>(null);
  const pendingProductRef = useRef<{ product: Product; isNew: boolean } | null>(null);
  const productsRef = useRef(products);
  const filtersRef = useRef(filters);
  const pageRef = useRef(page);
  const pageSizeRef = useRef(pageSize);
  const productsTotalCountRef = useRef(productsTotalCount);
  const listSummaryRef = useRef(listSummary);
  const [teamAccounts, setTeamAccounts] = useState<TeamAccountRecord[]>([]);
  const shellUser = useAppShellUser();
  const creatorName = shellUser?.userName?.trim() || "当前创建人";
  const currentUserName = creatorName === "当前创建人" ? "" : creatorName.trim();
  const teamMembers = useMemo(() => accountsToTeamMembers(teamAccounts), [teamAccounts]);
  const opsOptions = useMemo(() => getTeamMemberOptions(teamMembers, ["operations_supervisor", "operations"]), [teamMembers]);
  const designerOptions = useMemo(() => getTeamMemberOptions(teamMembers, ["designer"]), [teamMembers]);

  useEffect(() => {
    const pollingTimers = exportPollingTimersRef.current;
    const pollingJobs = exportPollingJobsRef.current;

    return () => {
      for (const timer of pollingTimers.values()) {
        window.clearTimeout(timer);
      }
      pollingTimers.clear();
      pollingJobs.clear();
    };
  }, []);
  const opsFilterOptions = useMemo(() => getAccountNameOptionsByRoleIds(teamAccounts, ["operations"]), [teamAccounts]);
  const selectionOwnerFilterOptions = useMemo(() => getAccountNameOptionsByRoleIds(teamAccounts, ["developer", "procurement"]), [teamAccounts]);
  const designerFilterOptions = useMemo(() => getAccountNameOptionsByRoleIds(teamAccounts, ["designer"]), [teamAccounts]);
  const newProductStatusValues = useMemo(() => new Set(newProductStatusOptions.map((option) => option.value)), []);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    pageSizeRef.current = pageSize;
  }, [pageSize]);

  useEffect(() => {
    productsTotalCountRef.current = productsTotalCount;
  }, [productsTotalCount]);

  useEffect(() => {
    listSummaryRef.current = listSummary;
  }, [listSummary]);

  useEffect(() => {
    let canceled = false;
    let cancelScheduledTask: (() => void) | null = null;

    async function loadTeamAccounts() {
      const apiAccounts = await loadTeamAccountsFromApi();
      if (canceled) return;

      setTeamAccounts(apiAccounts);
    }

    cancelScheduledTask = scheduleNonCriticalTask(() => {
      void loadTeamAccounts();
    });

    return () => {
      canceled = true;
      cancelScheduledTask?.();
    };
  }, []);

  const fetchProducts = useCallback(async (input: {
    filters: ProductFilters;
    page: number;
    pageSize: number;
    includeSummary?: boolean;
    detail?: boolean;
    signal?: AbortSignal;
  }) => {
    const requestCacheKey = getProductListRequestCacheKey(input);
    const cached = productListResponseCache.get(requestCacheKey);
    if (cached && Date.now() - cached.cachedAt < REQUEST_CACHE_TTL_MS) {
      return cached.data;
    }

    const inFlight = productListInflight.get(requestCacheKey);
    if (inFlight) {
      return inFlight;
    }

    const params = requestCacheKey.split("::").slice(1).join("::");
    const promise = (async () => {
      const response = await fetch(`/api/products?${params}`, { cache: "no-store", signal: input.signal });
      const data = (await response.json()) as {
        products?: Array<Product | ProductListItem>;
        pagination?: { total?: number; pageCount?: number };
        summary?: ProductListSummary;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "商品数据读取失败");
      }

      productListResponseCache.set(requestCacheKey, { cachedAt: Date.now(), data });
      return data;
    })();

    productListInflight.set(requestCacheKey, promise);

    try {
      return await promise;
    } finally {
      productListInflight.delete(requestCacheKey);
    }
  }, []);

  const loadProductSummary = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++summaryRequestSeq.current;
    const requestSignal = signal ?? new AbortController().signal;
    const requestCacheKey = getProductSummaryRequestCacheKey();
    const cached = productSummaryResponseCache.get(requestCacheKey);

    if (cached && Date.now() - cached.cachedAt < REQUEST_CACHE_TTL_MS) {
      if (!requestSignal.aborted && requestId === summaryRequestSeq.current && cached.data.summary) {
        setListSummary(cached.data.summary);
        setSummaryReady(true);
      }

      return;
    }

    const inFlight = productSummaryInflight.get(requestCacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      try {
        const params = new URLSearchParams({
          summaryOnly: "true",
          includeSummary: "true",
        });
        const response = await fetch(`/api/products?${params.toString()}`, {
          cache: "no-store",
          signal: requestSignal,
        });
        const data = (await response.json()) as { summary?: ProductListSummary; error?: string };

        if (requestSignal.aborted || requestId !== summaryRequestSeq.current) {
          return data;
        }

        if (!response.ok || !data.summary) {
          throw new Error(data.error || "商品统计读取失败");
        }

        productSummaryResponseCache.set(requestCacheKey, { cachedAt: Date.now(), data });

        setListSummary(data.summary);
        setSummaryReady(true);
        writeCachedProductWorkbench({
          products: productsRef.current,
          filters: filtersRef.current,
          page: pageRef.current,
          pageSize: pageSizeRef.current,
          totalCount: productsTotalCountRef.current,
          summary: data.summary,
        });

        return data;
      } catch (error) {
        if (requestSignal.aborted || requestId !== summaryRequestSeq.current) {
          return { error: error instanceof Error ? error.message : "商品统计读取失败" };
        }

        setSummaryReady(true);
        const message = error instanceof Error ? error.message : "商品统计读取失败";
        setActivityLog((current) => [`商品统计读取失败：${message}`, ...current].slice(0, 8));
        throw error;
      }
    })();

    productSummaryInflight.set(requestCacheKey, promise);

    try {
      return await promise;
    } finally {
      productSummaryInflight.delete(requestCacheKey);
    }
  }, []);

  useEffect(() => {
    if (!currentUserName) {
      setMySkuCount(0);
      setMySkuReady(false);
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    let cancelScheduledTask: (() => void) | null = null;

    cancelScheduledTask = scheduleNonCriticalTask(() => void (async () => {
      try {
        const data = await fetchProducts({
          filters: {
            ...initialFilters,
            mySkuOwner: currentUserName,
          },
          page: 1,
          pageSize: 1,
          includeSummary: false,
          detail: false,
          signal: controller.signal,
        });

        if (disposed || controller.signal.aborted) {
          return;
        }

        setMySkuCount(data.pagination?.total ?? 0);
        setMySkuReady(true);
      } catch {
        if (disposed || controller.signal.aborted) {
          return;
        }

        setMySkuReady(true);
      }
    })());

    return () => {
      disposed = true;
      cancelScheduledTask?.();
      controller.abort();
    };
  }, [currentUserName, fetchProducts]);

  function mergePendingProduct(
    nextProducts: Product[],
    nextTotalCount: number,
    nextFilters: ProductFilters,
    nextPage: number,
    nextPageSize: number,
  ) {
    const pending = pendingProductRef.current;
    if (!pending) {
      return { products: nextProducts, totalCount: nextTotalCount };
    }

    const pendingSku = pending.product.sku.trim();
    const projectedIndex = nextProducts.findIndex((product) => product.sku.trim() === pendingSku);
    if (projectedIndex >= 0) {
      pendingProductRef.current = null;
      return {
        products: nextProducts.map((product) => (product.sku.trim() === pendingSku ? pending.product : product)),
        totalCount: nextTotalCount,
      };
    }

    if (pending.isNew && nextPage === 1 && !hasActiveProductListFilters(nextFilters)) {
      return {
        products: [pending.product, ...nextProducts].slice(0, nextPageSize),
        totalCount: nextTotalCount + 1,
      };
    }

    return { products: nextProducts, totalCount: nextTotalCount };
  }

  useEffect(() => {
    const isFirstLoad = !initialDataConsumedRef.current;
    const hasMatchingServerData =
      isFirstLoad
      && Boolean(initialData)
      && readCurrentWorkspaceId() === initialData?.workspaceId
      && page === initialData?.pagination.page
      && pageSize === initialData?.pagination.pageSize
      && !hasActiveProductListFilters(filters);

    initialDataConsumedRef.current = true;

    if (hasMatchingServerData) {
      previousFiltersRef.current = filters;
      previousPageRef.current = page;
      previousPageSizeRef.current = pageSize;
      return;
    }

    const filtersChanged = previousFiltersRef.current !== null
      && JSON.stringify(previousFiltersRef.current) !== JSON.stringify(filters);
    const shouldDebounce = !isFirstLoad && filtersChanged;
    previousFiltersRef.current = filters;
    previousPageRef.current = page;
    previousPageSizeRef.current = pageSize;
    const requestId = ++productsRequestSeq.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      async function loadProducts() {
        setProductsLoading(true);
        setProductsError("");

        try {
          const data = await fetchProducts({
            filters,
            page,
            pageSize,
            includeSummary: true,
            detail: true,
            signal: controller.signal,
          });

          if (controller.signal.aborted || requestId !== productsRequestSeq.current) {
            return;
          }

          const fetchedProducts = Array.isArray(data.products)
            ? data.products.map((product) => product as Product)
            : [];
          const merged = mergePendingProduct(
            fetchedProducts,
            data.pagination?.total ?? 0,
            filters,
            page,
            pageSize,
          );
          const nextProducts = merged.products;
          const nextTotalCount = merged.totalCount;

          setProducts(nextProducts);
          setProductsTotalCount(nextTotalCount);
          if (data.summary) {
            setListSummary(data.summary);
            setSummaryReady(true);
          }
          writeCachedProductWorkbench({
            products: nextProducts,
            filters,
            page,
            pageSize,
            totalCount: nextTotalCount,
            summary: data.summary ?? listSummaryRef.current,
          });
          setActivityLog((current) => ["已从数据库读取商品列表", ...current].slice(0, 8));
          if (!data.summary) {
            void loadProductSummary();
          }
        } catch (error) {
          if (controller.signal.aborted || requestId !== productsRequestSeq.current) {
            return;
          }

          const message = error instanceof Error ? error.message : "商品数据读取失败";
          setProductsError(message);
          setActivityLog((current) => [`商品数据读取失败：${message}`, ...current].slice(0, 8));
        } finally {
          if (!controller.signal.aborted && requestId === productsRequestSeq.current) {
            setProductsLoading(false);
          }
        }
      }

      void loadProducts();
    }, shouldDebounce ? 180 : 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [fetchProducts, filters, initialData, loadProductSummary, page, pageSize]);

  async function reloadProducts(input?: { filters?: ProductFilters; page?: number; pageSize?: number }) {
    const nextFilters = input?.filters ?? filters;
    const nextPage = input?.page ?? page;
    const nextPageSize = input?.pageSize ?? pageSize;
    const requestId = ++productsRequestSeq.current;
    const controller = new AbortController();
    setProductsLoading(true);
    setProductsError("");

    try {
      const data = await fetchProducts({
        filters: nextFilters,
        page: nextPage,
        pageSize: nextPageSize,
        includeSummary: true,
        detail: true,
        signal: controller.signal,
      });
      const fetchedProducts = Array.isArray(data.products)
        ? data.products.map((product) => product as Product)
        : [];
      const merged = mergePendingProduct(
        fetchedProducts,
        data.pagination?.total ?? 0,
        nextFilters,
        nextPage,
        nextPageSize,
      );
      const nextProducts = merged.products;
      const nextTotalCount = merged.totalCount;
      const nextSummary = data.summary ?? listSummary;

      if (controller.signal.aborted || requestId !== productsRequestSeq.current) {
        return;
      }

      setProducts(nextProducts);
      setProductsTotalCount(nextTotalCount);
      if (data.summary) {
        setListSummary(data.summary);
        setSummaryReady(true);
      }
      writeCachedProductWorkbench({
        products: nextProducts,
        filters: nextFilters,
        page: nextPage,
        pageSize: nextPageSize,
        totalCount: nextTotalCount,
        summary: nextSummary,
      });
      if (!data.summary) {
        void loadProductSummary(controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted || requestId !== productsRequestSeq.current) {
        return;
      }
      setProductsError(error instanceof Error ? error.message : "商品数据读取失败");
    } finally {
      if (!controller.signal.aborted && requestId === productsRequestSeq.current) {
        setProductsLoading(false);
      }
    }
  }

  const pageCount = Math.max(1, Math.ceil(productsTotalCount / pageSize));

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  function applyFilters(nextFilters: ProductFilters) {
    setPage(1);
    setFilters(nextFilters);
  }

  function patchFilters(updater: (current: ProductFilters) => ProductFilters) {
    setPage(1);
    setFilters((current) => updater(current));
  }

  const developingCount = listSummary.developing;
  const opsReviewCount = listSummary.opsReview;
  const designInProgressCount = listSummary.designInProgress;
  const listingConfirmingCount = listSummary.operationsProgress;
  const overdueCount = listSummary.overdue;
  const summaryValue = (value: number) => (summaryReady ? value.toLocaleString("zh-CN") : "…");
  const mySkuValue = mySkuReady ? mySkuCount.toLocaleString("zh-CN") : "…";

  function openNewProduct() {
    productDetailRequestSeq.current += 1;
    setActiveProduct(null);
    setDetailReady(true);
    setIsEditorOpen(true);
  }

  function closeProductEditor() {
    productDetailRequestSeq.current += 1;
    setIsEditorOpen(false);
  }

  async function openProduct(sku: string) {
    const normalizedSku = sku.trim();
    const workspaceId = readCurrentWorkspaceId();
    const fullCacheKey = getProductDetailCacheKeyWithMode(workspaceId, normalizedSku, true);
    const textCacheKey = getProductDetailCacheKeyWithMode(workspaceId, normalizedSku, false);
    const cachedDetail = productDetailCache.get(fullCacheKey);
    const cachedTextDetail = productDetailCache.get(textCacheKey);
    const listProduct = productsRef.current.find((product) => product.sku.trim() === normalizedSku) ?? null;

    setProductsError("");
    setActiveProduct(cachedDetail ?? cachedTextDetail ?? listProduct);
    setDetailReady(Boolean(cachedDetail ?? cachedTextDetail ?? listProduct));
    setIsEditorOpen(true);

    if (cachedDetail) {
      setActiveProduct(cachedDetail);
      setDetailReady(true);
      return;
    }

    const requestId = ++productDetailRequestSeq.current;
    setDetailReady(false);
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(normalizedSku)}/detail`, {
        cache: "no-store",
      });
      const data = (await response.json()) as { product?: Product; error?: string };
      if (requestId !== productDetailRequestSeq.current) {
        return;
      }
      if (!response.ok || !data.product) {
        throw new Error(data.error || "商品详情读取失败");
      }
      productDetailCache.set(fullCacheKey, data.product);
      setActiveProduct(data.product);
      setDetailReady(true);
    } catch (error) {
      if (requestId !== productDetailRequestSeq.current) {
        return;
      }
      const message = error instanceof Error ? error.message : "商品详情读取失败";
      setProductsError(message);
      setDetailReady(true);
    }
  }

  async function persistProduct(product: Product) {
    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product }),
    });
    const data = (await response.json()) as { product?: Product; error?: string; conflict?: boolean; currentRevision?: number };

    if (!response.ok || !data.product) {
      const error = new Error(data.error || "商品保存失败");
      if (data.conflict) {
        error.name = "ProductRevisionConflictError";
      }
      throw error;
    }

    return data.product;
  }

  async function handleSaveProduct(draft: ProductDraft) {
    productDetailRequestSeq.current += 1;
    const existing = activeProduct;
    const normalizedStatus = existing || newProductStatusValues.has(draft.status) ? draft.status : "pending";
    const nextProduct: Product = {
      ...draft,
      images: [],
      status: normalizedStatus,
      id: existing?.id ?? `prod-${draft.sku}`,
      sku: existing?.sku ?? draft.sku,
      createdAt: existing?.createdAt ?? formatDateTime(new Date()),
    };
    try {
      const savedProduct = await persistProduct(nextProduct);
      invalidateProductRequestCaches();
      productDetailCache.set(getProductDetailCacheKeyWithMode(readCurrentWorkspaceId(), savedProduct.sku, true), savedProduct);
      pendingProductRef.current = {
        product: toLightweightProduct(savedProduct),
        isNew: !existing,
      };
      setActiveProduct(savedProduct);
      setDetailReady(true);
      setProducts((current) => {
        const savedSku = savedProduct.sku.trim();
        const savedLightweightProduct = toLightweightProduct(savedProduct);
        const existingIndex = current.findIndex((product) => product.sku.trim() === savedSku);
        if (existingIndex >= 0) {
          return current.map((product) => (product.sku.trim() === savedSku ? savedLightweightProduct : product));
        }
        return [savedLightweightProduct, ...current];
      });
      if (!existing) {
        setProductsTotalCount((current) => current + 1);
      }
      if (!existing) {
        setPage(1);
      }
      closeProductEditor();
      void reloadProducts({ page: existing ? page : 1 }).catch((reloadError) => {
        const message = reloadError instanceof Error ? reloadError.message : "商品列表刷新失败";
        setProductsError(message);
        setActivityLog((current) => [`商品已保存，但列表刷新失败：${message}`, ...current].slice(0, 8));
      });
      setActivityLog((current) => [`${existing ? "保存" : "新增"}商品 ${savedProduct.sku} 到数据库`, ...current].slice(0, 8));
    } catch (error) {
      const message = error instanceof Error ? error.message : "商品保存失败";
      window.alert(error instanceof Error && error.name === "ProductRevisionConflictError"
        ? `${message}\n\n当前页面数据已过期，请关闭后重新打开商品再保存。`
        : message);
      setActivityLog((current) => [`商品保存失败：${message}`, ...current].slice(0, 8));
    }
  }

function handleSaveTrialProduct(draft: TrialProductDraft) {
    const nextTrialProduct = {
      ...draft,
      id: draft.id ?? `trial-${Date.now()}`,
    };

    setTrialProducts((current) => [nextTrialProduct, ...current]);
    setIsTrialEditorOpen(false);
    setActivityLog((current) => [`新增试算商品 ${nextTrialProduct.title || nextTrialProduct.pricingRows[0]?.name || "未命名"}`, ...current].slice(0, 8));
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      productDetailRequestSeq.current += 1;
      const imported = await parseProductWorkbookFile(file, products, getNextSku(products));
      const importedWithOwner = {
        ...imported,
        selectionOwner: creatorName,
        developer: "",
      };
      const importedWithAssets = await uploadEmbeddedProductImages(importedWithOwner);
      const savedProduct = await persistProduct(importedWithAssets);
      invalidateProductRequestCaches();
      productDetailCache.set(getProductDetailCacheKeyWithMode(readCurrentWorkspaceId(), savedProduct.sku, true), savedProduct);
      setActiveProduct(savedProduct);
      setDetailReady(true);
      setIsEditorOpen(true);
      void reloadProducts({ page: 1 }).catch((reloadError) => {
        const message = reloadError instanceof Error ? reloadError.message : "商品列表刷新失败";
        setProductsError(message);
        setActivityLog((current) => [`商品已导入并保存，但列表刷新失败：${message}`, ...current].slice(0, 8));
      });
      setActivityLog((current) => [`已导入 ${file.name} 并保存到数据库`, ...current].slice(0, 8));
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
      window.alert(message);
      setActivityLog((current) => [`导入失败：${message}`, ...current].slice(0, 8));
    }
  }

  async function downloadProductExport(downloadUrl: string, fileName: string) {
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = fileName;
    anchor.click();
  }

  function stopProductExportPolling(jobId: string) {
    const timer = exportPollingTimersRef.current.get(jobId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      exportPollingTimersRef.current.delete(jobId);
    }
    exportPollingJobsRef.current.delete(jobId);
  }

  function pollProductExport(jobId: string, attempt = 0) {
    if (attempt === 0) {
      if (exportPollingJobsRef.current.has(jobId)) {
        return;
      }
      exportPollingJobsRef.current.add(jobId);
    } else if (!exportPollingJobsRef.current.has(jobId)) {
      return;
    }

    const checkStatus = async () => {
      if (attempt >= 120) {
        stopProductExportPolling(jobId);
        setExportNotice({
          tone: "info",
          message: "商品导出等待时间较长，任务仍在后台处理，请到任务中心查看进度。",
          jobId,
        });
        setActivityLog((current) => [`商品导出仍在处理中，请到任务中心查看任务 ${jobId}`, ...current].slice(0, 8));
        window.alert("商品导出等待时间较长，请到任务中心查看进度和下载文件。");
        return;
      }

      try {
        const response = await fetch(`/api/products/export/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const data = (await response.json()) as {
          job?: { status?: string; error?: string | null; file?: { originalName?: string } | null };
          error?: string;
        };

        if (response.ok && data.job?.status === "done") {
          const fileName = data.job.file?.originalName ?? "products.xlsx";
          await downloadProductExport(`/api/products/export/${encodeURIComponent(jobId)}/download`, fileName);
          stopProductExportPolling(jobId);
          setExportNotice({
            tone: "success",
            message: `商品导出已完成，文件已开始下载：${fileName}`,
            jobId,
          });
          setActivityLog((current) => [`商品导出已完成并自动下载 ${fileName}`, ...current].slice(0, 8));
          window.alert(`商品导出已完成，文件已开始下载：${fileName}`);
          return;
        }

        if (response.ok && data.job?.status === "failed") {
          const message = data.job.error || "商品导出失败";
          stopProductExportPolling(jobId);
          setExportNotice({
            tone: "error",
            message,
            jobId,
          });
          setActivityLog((current) => [`商品导出失败：${message}`, ...current].slice(0, 8));
          window.alert(message);
          return;
        }
      } catch {
        // Keep polling through temporary network failures.
      }

      const nextAttempt = attempt + 1;
      const timer = window.setTimeout(() => {
        exportPollingTimersRef.current.delete(jobId);
        pollProductExport(jobId, nextAttempt);
      }, 5_000);
      exportPollingTimersRef.current.set(jobId, timer);
    };

    void checkStatus();
  }

  async function handleExportProducts() {
    if (exportingProducts) {
      return;
    }

    setExportingProducts(true);
    try {
      const params = new URLSearchParams({
        search: filters.keyword.trim(),
        asin: filters.asin.trim(),
        supplierName: filters.supplierName.trim(),
        status: filters.status,
        opsAssignees: filters.opsAssignees.join(","),
        selectionOwners: filters.selectionOwners.join(","),
        designerAssignees: filters.designerAssignees.join(","),
        createdByMe: filters.mySkuOwner.trim() ? "true" : "",
        minPrice: filters.minPrice.trim(),
        maxPrice: filters.maxPrice.trim(),
      });
      const response = await fetch(`/api/products/export?${params.toString()}`, { method: "POST" });
      const data = (await response.json()) as {
        file?: { downloadUrl?: string; name?: string } | null;
        job?: { id: string; status: string; file?: { originalName?: string } | null } | null;
        queued?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "商品导出失败");
      }

      if (data.file?.downloadUrl) {
        await downloadProductExport(data.file.downloadUrl, data.file.name ?? "products.xlsx");
        setExportNotice({
          tone: "success",
          message: `商品导出已完成，文件已开始下载：${data.file.name ?? "products.xlsx"}`,
        });
        setActivityLog((current) => [`商品导出已完成并生成文件 ${data.file?.name ?? "products.xlsx"}`, ...current].slice(0, 8));
        return;
      }

      if (!data.job?.id) {
        throw new Error("商品导出任务创建失败");
      }

      setExportNotice({
        tone: "info",
        message: "商品导出任务已提交，正在后台处理。页面会每 5 秒检查一次，完成后自动下载并通知。",
        jobId: data.job.id,
      });
      setActivityLog((current) => [`商品导出任务已提交，完成后将自动下载并通知`, ...current].slice(0, 8));
      pollProductExport(data.job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "商品导出失败";
      setActivityLog((current) => [`商品导出失败：${message}`, ...current].slice(0, 8));
      window.alert(message);
    } finally {
      setExportingProducts(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
        {productsError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{productsError}</div>
        ) : null}
        {productsLoading && !products.length ? (
          <div className="rounded-md border border-border bg-white px-4 py-3 text-sm font-semibold text-muted">正在从数据库读取商品数据...</div>
        ) : null}
        {exportNotice ? (
          <div className={`flex flex-col gap-2 rounded-md border px-3 py-2 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between ${getProductExportNoticeClass(exportNotice.tone)}`}>
            <span>
              {exportNotice.message}
              {exportNotice.jobId ? <span className="ml-2 text-xs opacity-80">任务 {exportNotice.jobId}</span> : null}
            </span>
            <a href="/tasks" className="text-xs font-bold underline underline-offset-2">查看任务中心</a>
          </div>
        ) : null}
        <section className="grid grid-cols-[repeat(auto-fit,128px)] justify-start gap-2">
          <SummaryTile
            label="全部商品"
            value={productsTotalCount.toLocaleString("zh-CN")}
            active={filters.status === "all"}
            onClick={() => patchFilters((current) => ({ ...current, status: "all" }))}
          />
          <SummaryTile
            label="开发中"
            value={summaryValue(developingCount)}
            tone="blue"
            active={filters.status === "development_phase"}
            onClick={() => patchFilters((current) => ({ ...current, status: "development_phase" }))}
          />
          <SummaryTile
            label="运营确认中"
            value={summaryValue(opsReviewCount)}
            tone="amber"
            active={filters.status === "ops_review"}
            onClick={() => patchFilters((current) => ({ ...current, status: "ops_review" }))}
          />
          <SummaryTile
            label="美工处理中"
            value={summaryValue(designInProgressCount)}
            tone="blue"
            active={filters.status === "design_in_progress"}
            onClick={() => patchFilters((current) => ({ ...current, status: "design_in_progress" }))}
          />
          <SummaryTile
            label="运营进度"
            value={summaryValue(listingConfirmingCount)}
            tone="amber"
            active={filters.status === "operations_progress"}
            onClick={() => patchFilters((current) => ({ ...current, status: "operations_progress" }))}
          />
          <SummaryTile
            label="超期预警"
            value={summaryValue(overdueCount)}
            tone="red"
            active={filters.status === "overdue"}
            onClick={() => patchFilters((current) => ({ ...current, status: "overdue" }))}
          />
          <SummaryTile
            label="我的SKU"
            value={mySkuValue}
            tone="green"
            active={filters.mySkuOwner.trim() === currentUserName && Boolean(currentUserName)}
            onClick={() =>
              patchFilters((current) => ({
                ...current,
                mySkuOwner: current.mySkuOwner.trim() ? "" : currentUserName,
              }))
            }
          />
        </section>
        <p className="px-1 text-xs font-medium text-muted">
          顶部卡片按业务阶段聚合统计，开发中会合并待开发与开发中；运营进度、超期和我的 SKU 可以与其它卡片重叠。
        </p>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>产品列表</CardTitle>
              <p className="mt-1 text-xs font-medium text-muted">新增 SKU 默认待开发；流转后超过 3 天且未上架、未取消的商品会自动进入超期预警。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={importInputRef}
                className="hidden"
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  void handleImportFile(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              <Button variant="secondary" size="sm" onClick={() => importInputRef.current?.click()}>
                <FileUp className="h-4 w-4" />
                导入数据
              </Button>
              <Button variant="secondary" size="sm" disabled={exportingProducts} onClick={() => void handleExportProducts()}>
                <FileDown className="h-4 w-4" />
                {exportingProducts ? "提交中..." : "导出数据"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setIsActivityLogOpen(true)}>
                <History className="h-4 w-4" />
                操作日志
              </Button>
              <Button size="sm" onClick={openNewProduct}>
                <PackagePlus className="h-4 w-4" />
                新增商品
              </Button>
              <Button size="sm" onClick={() => setIsTrialEditorOpen(true)}>
                <PackagePlus className="h-4 w-4" />
                新增试算商品
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProductFiltersBar
              filters={filters}
              opsAssigneeOptions={opsFilterOptions}
              selectionOwnerOptions={selectionOwnerFilterOptions}
              designerAssigneeOptions={designerFilterOptions}
              onChange={applyFilters}
              onReset={() => applyFilters(initialFilters)}
              onSearch={() => void reloadProducts()}
            />
            <ProductTable
              products={products}
              totalCount={productsTotalCount}
              loading={productsLoading}
              onOpenProduct={(sku) => void openProduct(sku)}
              onOpenHistory={setVersionProduct}
            />
            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              pageSizeOptions={pageSizeOptions}
              onPageChange={setPage}
              onPageSizeChange={(nextPageSize) => {
                setPage(1);
                setPageSize(nextPageSize);
              }}
            />
          </CardContent>
        </Card>

        {isActivityLogOpen ? (
          <ActivityLogModal entries={activityLog} onClose={() => setIsActivityLogOpen(false)} />
        ) : null}

        {versionProduct ? (
          <ProductVersionModal
            product={versionProduct}
            onClose={() => setVersionProduct(null)}
            onRestored={() => {
              void reloadProducts();
              setActivityLog((current) => [`已恢复商品 ${versionProduct.sku} 的历史版本`, ...current].slice(0, 8));
            }}
          />
        ) : null}

        {isEditorOpen ? (
            <ProductEditor
              product={activeProduct}
              products={products}
              nextSku={getNextSku(products)}
              creatorName={creatorName}
              detailReady={detailReady}
            opsOptions={opsOptions}
            designerOptions={designerOptions}
            onClose={closeProductEditor}
            onSave={handleSaveProduct}
          />
        ) : null}

        {isTrialEditorOpen ? (
          <ExtractedTrialProductEditor
            onClose={() => setIsTrialEditorOpen(false)}
            onSave={handleSaveTrialProduct}
          />
        ) : null}
      </div>
    </>
  );
}

function ProductEditor({
  product,
  products,
  nextSku,
  creatorName,
  detailReady,
  opsOptions,
  designerOptions,
  onClose,
  onSave,
}: {
  product: Product | null;
  products: Product[];
  nextSku: string;
  creatorName: string;
  detailReady: boolean;
  opsOptions: string[];
  designerOptions: string[];
  onClose: () => void;
  onSave: (draft: ProductDraft) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<ProductEditorDraft>(() => productToDraft(product, products, nextSku));
  const [saving, setSaving] = useState(false);
  const [operationsProgressOpen, setOperationsProgressOpen] = useState(false);
  const [videoPlanOpen, setVideoPlanOpen] = useState(false);
  const [conclusionUploading, setConclusionUploading] = useState(false);
  const [imageUploads, setImageUploads] = useState<ProductImageUploadProgress[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const conclusionInputRef = useRef<HTMLInputElement | null>(null);
  const productRef = useRef(product);
  const productsRef = useRef(products);
  const nextSkuRef = useRef(nextSku);
  const draftSourceKeyRef = useRef("");

  const isEditing = Boolean(product);
  const showHeavyDetail = !isEditing || detailReady;
  const mainAmazonLink = buildAmazonLink(draft.asin);
  const workbookDetail = draft.workbookDetail;
  const workflowStage = getProductWorkflowStage(draft);
  const workflowAssignee = getCurrentWorkflowAssignee(draft);
  const workflowOverdue = isProductWorkflowOverdue(draft);
  const canMarkWorkflowDone = isOperationsProgressComplete(draft.operationsProgress);
  const selectionOwner = draft.selectionOwner || (isEditing ? product?.selectionOwner : creatorName) || creatorName;
  const selectedOps = normalizeAssigneeList(draft.opsAssignee, draft.opsAssignees);
  const selectedDesigners = normalizeAssigneeList(draft.designerAssignee, draft.designerAssignees);
  const showListingActions = ["listing_confirming", "design_in_progress", "listed", "delisted"].includes(draft.status);
  const statusOptions = isEditing ? productStatusOptions : newProductStatusOptions;
  const requiresConclusionExcel = draft.status === "canceled" || draft.status === "listed";

  function openImagePreview(asset?: ProductImageAsset, fallbackImage?: string) {
    const source = getProductAssetDownloadUrl(asset) || (fallbackImage?.startsWith("data:") ? "" : fallbackImage || "");
    if (!source) {
      return;
    }
    setPreviewLoading(true);
    setPreviewImage(source);
  }

  useEffect(() => {
    productRef.current = product;
  }, [product]);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    nextSkuRef.current = nextSku;
  }, [nextSku]);

  useEffect(() => {
    const productKey = product?.id || product?.sku || "";
    const imageAssetCount = Array.isArray(product?.imageAssets) ? product.imageAssets.length : 0;
    const sourceKey = !isEditing
      ? `new:${nextSkuRef.current}`
      : `${productKey}:${detailReady ? "detail" : "preview"}:${imageAssetCount}`;

    if (draftSourceKeyRef.current !== sourceKey) {
      draftSourceKeyRef.current = sourceKey;
      setDraft(productToDraft(productRef.current, productsRef.current, nextSkuRef.current));
    }
  }, [detailReady, isEditing, product]);

  function setField<K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateStatus(status: ProductStatus) {
    const nextStage =
      status === "ops_review"
        ? "ops_confirming"
        : status === "design_in_progress"
          ? "design_in_progress"
          : status === "listing_confirming"
            ? "design_review"
          : status === "listed"
            ? "done"
            : status === "canceled" || status === "delisted" || status === "patent_risk"
              ? "blocked"
              : "selection_pending";
    const now = new Date();

    setDraft((current) => ({
      ...current,
      status,
      workflowStage: nextStage,
      workflowUpdatedAt: now.toISOString(),
      workflowDueAt: nextStage === "done" || nextStage === "blocked" ? "" : current.workflowDueAt || createWorkflowDueAt(now),
    }));
  }

  function updateAssigneeList(field: "opsAssignees" | "designerAssignees", values: string[]) {
    const normalized = Array.from(new Set(values.filter(Boolean)));

    setDraft((current) => ({
      ...current,
      [field]: normalized,
      ...(field === "opsAssignees" ? { opsAssignee: formatAssigneeList(normalized) } : { designerAssignee: formatAssigneeList(normalized) }),
    }));
  }

  function buildWorkflowDraft(stage: ProductWorkflowStage, note: string) {
    const now = new Date();
    const assigneeName =
      stage === "ops_confirming"
        ? formatAssigneeList(selectedOps)
        : stage === "design_in_progress" || stage === "design_review"
          ? formatAssigneeList(selectedDesigners)
          : workflowAssignee;

    const event = buildWorkflowEvent({
      stage,
      actorName: creatorName,
      assigneeName,
      note,
      createdAt: now,
    });

    return {
      ...draft,
      status:
        stage === "ops_confirming"
          ? "ops_review"
          : stage === "design_in_progress" || stage === "design_review"
            ? "design_in_progress"
            : stage === "done"
              ? "listed"
              : draft.status,
      workflowStage: stage,
      workflowStartedAt: now.toISOString(),
      workflowUpdatedAt: now.toISOString(),
      workflowDueAt: stage === "done" || stage === "blocked" ? "" : createWorkflowDueAt(now),
      opsAssignees: selectedOps,
      opsAssignee: formatAssigneeList(selectedOps),
      designerAssignees: selectedDesigners,
      designerAssignee: formatAssigneeList(selectedDesigners),
      editableBy: stage === "ops_confirming" || stage === "design_in_progress" || stage === "design_review" ? selectedOps : [],
      viewableBy: [...selectedOps, ...selectedDesigners],
      workflowHistory: [event, ...(draft.workflowHistory ?? [])].slice(0, 20),
    };
  }

  async function saveDraft(nextDraft: ProductEditorDraft) {
    const normalizedStage = getProductWorkflowStage(nextDraft);
    const now = new Date();
    const workflowHistory = nextDraft.workflowHistory?.length
      ? nextDraft.workflowHistory
      : [
          buildWorkflowEvent({
            stage: normalizedStage,
            actorName: creatorName,
            assigneeName:
              normalizedStage === "ops_confirming"
                ? formatAssigneeList(selectedOps)
                : normalizedStage === "design_in_progress" || normalizedStage === "design_review"
                  ? formatAssigneeList(selectedDesigners)
                  : selectionOwner,
            note: "创建商品并进入业务流程。",
            createdAt: now,
          }),
        ];

    await Promise.resolve(
      onSave({
        ...nextDraft,
        sku: nextDraft.sku.trim(),
        chineseName: nextDraft.chineseName.trim(),
        englishName: nextDraft.englishName.trim(),
        asin: nextDraft.asin.trim().toUpperCase(),
        cancelReason: nextDraft.cancelReason.trim(),
        competitorAsins: (Array.isArray(workbookDetail.competitors) ? workbookDetail.competitors : [])
          .map((competitor) => competitor.asin.trim().toUpperCase())
          .filter(Boolean),
        developer: "",
        selectionOwner,
        opsAssignees: selectedOps,
        opsAssignee: formatAssigneeList(selectedOps),
        designerAssignees: selectedDesigners,
        designerAssignee: formatAssigneeList(selectedDesigners),
        editableBy:
          normalizedStage === "ops_confirming" || normalizedStage === "design_in_progress" || normalizedStage === "design_review"
            ? selectedOps
            : [],
        viewableBy: [...selectedOps, ...selectedDesigners],
        workflowStage: normalizedStage,
        workflowStartedAt: nextDraft.workflowStartedAt || now.toISOString(),
        workflowUpdatedAt: now.toISOString(),
        workflowDueAt:
          normalizedStage === "done" || normalizedStage === "blocked"
            ? ""
            : nextDraft.workflowDueAt || createWorkflowDueAt(now),
        workflowHistory,
      }),
    );
  }

  async function handleSubmit(override?: Partial<ProductEditorDraft>) {
    if (saving) {
      return;
    }

    const nextDraft = { ...draft, ...override };

    if (!nextDraft.chineseName.trim() || !nextDraft.englishName.trim()) {
      window.alert("中文名和英文名为必填项。");
      return;
    }

    if ((nextDraft.status === "canceled" || nextDraft.status === "listed") && !nextDraft.conclusionExcelFile?.id) {
      window.alert("状态为已取消或已上架时，请先上传结论 Excel 表。");
      return;
    }

    if (nextDraft.status === "ops_review" && selectedOps.length === 0) {
      window.alert("状态为运营确认时，请至少选择一位运营负责人。");
      return;
    }

    if (nextDraft.status === "design_in_progress" && selectedDesigners.length === 0) {
      window.alert("状态为美工处理中时，请至少选择一位美工负责人。");
      return;
    }

    setSaving(true);
    try {
      await saveDraft(nextDraft);
    } finally {
      setSaving(false);
    }
  }

  function moveWorkflow(stage: ProductWorkflowStage, note: string) {
    const nextDraft = buildWorkflowDraft(stage, note);
    setDraft(nextDraft);
    void saveDraft(nextDraft);
  }

  function setWorkbookDetail(updater: (current: TrialProductDraft) => TrialProductDraft) {
    setDraft((current) => ({ ...current, workbookDetail: updater(current.workbookDetail) }));
  }

  function updateWorkbookPricingRow(index: number, field: keyof TrialPriceRow, value: string | number) {
    setWorkbookDetail((current) => ({
      ...current,
      pricingRows: current.pricingRows.map((row, rowIndex) =>
        rowIndex === index
          ? { ...row, [field]: field === "name" ? String(value) : typeof value === "number" ? value : Number(value) || 0 }
          : row,
      ),
    }));
  }

  function addWorkbookPricingRow() {
    setWorkbookDetail((current) => {
      const previous = current.pricingRows[current.pricingRows.length - 1];
      const nextRow: TrialPriceRow = previous
        ? { ...previous, name: "" }
        : { name: "", lengthCm: 0, widthCm: 0, heightCm: 0, actualWeightKg: 0, suggestedPrice: 0, purchaseCost: 0, oceanFreightUnitPrice: 12, fbaFee: 0, exchangeRate: 6.9 };

      return { ...current, pricingRows: [...current.pricingRows, nextRow] };
    });
  }

  function removeWorkbookPricingRow() {
    setWorkbookDetail((current) => ({
      ...current,
      pricingRows: current.pricingRows.length > 1 ? current.pricingRows.slice(0, -1) : current.pricingRows,
    }));
  }

  function updateWorkbookCompetitor(index: number, field: keyof TrialCompetitorRow, value: string, asset?: ProductImageAsset) {
    setWorkbookDetail((current) => ({
      ...current,
      competitors: current.competitors.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }

        const nextRow = { ...row, [field]: value };
        if (field === "type" && value !== "直接竞品") {
          return {
            ...nextRow,
            negativePoint1: "",
            negativePoint2: "",
            negativePoint3: "",
            negativePoint4: "",
            negativePoint5: "",
          };
        }

        if (field === "hotVariantImage") {
          return { ...nextRow, hotVariantImageAsset: asset };
        }

        if (field === "noteImage") {
          return { ...nextRow, noteImageAsset: asset };
        }

        return nextRow;
      }),
    }));
    if (field === "asin") {
      setDraft((current) => {
        const next = [...current.competitorAsins];
        next[index] = value.trim();
        return { ...current, competitorAsins: next };
      });
    }
  }

  function addWorkbookCompetitor() {
    setWorkbookDetail((current) => ({
      ...current,
      competitors: [
        ...current.competitors,
        {
          type: "直接竞品",
          hotVariantImage: "",
          asin: "",
          sales30Days: "",
          variantCount: "",
          variantType: "",
          hotVariantSpec: "",
          hotVariantPrice: "",
          fbaFee: "",
          priceChangeNote: "",
          reviewCount: "",
          rating: "",
          negativePoint1: "",
          negativePoint2: "",
          negativePoint3: "",
          negativePoint4: "",
          negativePoint5: "",
          packageSize: "",
          note: "",
          noteImage: "",
          hotVariantImageAsset: undefined,
          noteImageAsset: undefined,
        },
      ],
    }));
  }

  function removeWorkbookCompetitor() {
    setWorkbookDetail((current) => ({
      ...current,
      competitors: current.competitors.length > 1 ? current.competitors.slice(0, -1) : current.competitors,
    }));
  }

  function updateWorkbookSupplier(index: number, field: keyof TrialSupplierRow, value: string | number) {
    setWorkbookDetail((current) => ({
      ...current,
      suppliers: current.suppliers.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]:
                field === "cost100" || field === "cost300"
                  ? typeof value === "number"
                    ? value
                    : Number(value) || 0
                  : value,
            }
          : row,
      ),
    }));
  }

  function addWorkbookSupplier() {
    setWorkbookDetail((current) => ({
      ...current,
      suppliers: [
        ...current.suppliers,
        {
          productUrl: "",
          factoryName: "",
          configuration: "",
          moq: "",
          leadTime: "",
          domesticFreightIncluded: "",
          certifications: "",
          patentCountry: "",
          packagingMethod: "",
          cost100: 0,
          cost300: 0,
          taxPoint: "",
          invoiceName: "",
          invoiceSpecUnit: "",
          invoiceRegion: "",
        },
      ],
    }));
  }

  function removeWorkbookSupplier() {
    setWorkbookDetail((current) => ({
      ...current,
      suppliers: current.suppliers.length > 1 ? current.suppliers.slice(0, -1) : current.suppliers,
    }));
  }

  function updateWorkbookImprovement(field: Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">, value: string) {
    setWorkbookDetail((current) => ({ ...current, improvement: { ...current.improvement, [field]: value } }));
  }

  function updateWorkbookPeakSeasonWeights(value: number[]) {
    setWorkbookDetail((current) => ({
      ...current,
      improvement: { ...current.improvement, peakSeasonWeights: value },
    }));
  }

  function updateWorkbookImprovementRow(index: number, field: TrialImprovementCellKey, value: string) {
    setWorkbookDetail((current) => {
      const rows = [...(current.improvement.rows ?? [])];
      rows[index] = {
        ...createEmptyImprovementRow(),
        ...getImprovementRow(current.improvement, index),
        [field]: value,
      };

      return {
        ...current,
        improvement: {
          ...current.improvement,
          rows,
        },
      };
    });
  }

  function updateWorkbookKeyword(index: number, field: keyof TrialKeywordRow, value: string | number) {
    setWorkbookDetail((current) => ({
      ...current,
      keywords: current.keywords.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: field === "keyword" ? String(value) : typeof value === "number" ? value : Number(value) || 0 } : row,
      ),
    }));
  }

  function replaceWorkbookKeywords(keywords: TrialKeywordRow[]) {
    setWorkbookDetail((current) => ({
      ...current,
      keywords: keywords.length ? keywords : current.keywords,
    }));
  }

  function updateWorkbookRemarkImages(images: string[], remarkImageAssets?: ProductImageAsset[]) {
    setWorkbookDetail((current) => ({
      ...current,
      remarkImages: images,
      remarkImageAssets: remarkImageAssets ?? current.remarkImageAssets,
    }));
  }

  async function handleImageUpload(files: FileList | null) {
    const currentImageCount = Math.max(draft.imageAssets?.length ?? 0, draft.images.length);
    const selected = selectProductImageFiles(files ?? [], currentImageCount);
    if (!selected.length) {
      return;
    }

    const uploads = selected.map((file, index) => ({
      id: `product-image-upload-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      file,
    }));
    setImageUploads(uploads.map(({ id, file }) => ({ id, name: file.name, progress: 0 })));

    try {
      const results = await Promise.allSettled(
        uploads.map(({ id, file }) =>
          uploadProductImageFile(file, {
            onUploadProgress: (progress) => {
              setImageUploads((current) => current.map((item) => (item.id === id ? { ...item, progress } : item)));
            },
          }),
        ),
      );
      const images = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const firstError = results.find((result) => result.status === "rejected");

      if (images.length) {
        setDraft((current) => ({
          ...current,
          images: [...current.images, ...images.map((image) => image.thumbUrl)].slice(0, 10),
          imageAssets: [...(current.imageAssets ?? []), ...images].slice(0, 10),
        }));
      }
      if (firstError?.status === "rejected") {
        window.alert(firstError.reason instanceof Error ? firstError.reason.message : "商品图片上传失败。");
      }
    } finally {
      setImageUploads([]);
    }
  }

  function removeImage(index: number) {
    setDraft((current) => ({
      ...current,
      images: current.images.filter((_, imageIndex) => imageIndex !== index),
      imageAssets: current.imageAssets?.filter((_, imageIndex) => imageIndex !== index),
    }));
  }

  async function handleConclusionUpload(file: File | undefined) {
    if (!file) {
      return;
    }
    if (file.size > PRODUCT_ATTACHMENT_MAX_BYTES) {
      window.alert(productAttachmentSizeError(file.name, file.size));
      return;
    }

    setConclusionUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/products/conclusion-files/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { file?: Product["conclusionExcelFile"]; error?: string };

      if (!response.ok || !data.file) {
        throw new Error(data.error || "结论 Excel 上传失败。");
      }

      setDraft((current) => ({ ...current, conclusionExcelFile: data.file }));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "结论 Excel 上传失败。");
    } finally {
      setConclusionUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-foreground/35 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">{isEditing ? `商品详情 ${draft.sku}` : "新增商品"}</h2>
            <p className="mt-1 text-xs font-medium text-muted">保存后会回到产品列表，SKU 页面与新增页面使用同一套字段。</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <input
              ref={conclusionInputRef}
              className="hidden"
              type="file"
              accept=".xlsx,.xls,.xlsm"
              onChange={(event) => {
                void handleConclusionUpload(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {showListingActions ? (
              <>
                <Button
                  variant={requiresConclusionExcel && !draft.conclusionExcelFile ? "secondary" : "ghost"}
                  size="sm"
                  className={compactToolbarButtonClass}
                  onClick={() => conclusionInputRef.current?.click()}
                  disabled={conclusionUploading}
                >
                  <FileUp className="h-4 w-4" />
                  {conclusionUploading ? "上传中" : "结论 Excel（必传）"}
                </Button>
                <Button variant="secondary" size="sm" className={compactToolbarButtonClass} onClick={() => setOperationsProgressOpen(true)}>
                  运营进度
                </Button>
                {showHeavyDetail ? (
                  <>
                    <Button variant="secondary" size="sm" className={compactToolbarButtonClass} onClick={() => setVideoPlanOpen(true)}>
                      <Video className="h-4 w-4" />
                      视频
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
            <Button variant="secondary" size="sm" className={compactToolbarButtonClass} onClick={onClose}>
              <X className="h-4 w-4" />
              取消
            </Button>
            <Button size="sm" className={compactToolbarButtonClass} onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "保存中" : "保存"}
            </Button>
          </div>
        </div>

        <div className="thin-scrollbar flex-1 overflow-auto p-5">
          <section className="space-y-4">
            <Card>
              <CardContent className="grid gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                <ProductEditorImagePanel
                  imageAssets={draft.imageAssets}
                  uploadingFiles={imageUploads}
                  onPreview={(asset) => openImagePreview(asset, asset.thumbUrl)}
                  onUpload={handleImageUpload}
                  onRemove={removeImage}
                />

                <div>
                  <h3 className="text-lg font-bold text-foreground">基础信息</h3>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <ReadonlyField label="SKU（系统生成）" value={draft.sku} />
                    <LabeledInput label="中文名（必填）" value={draft.chineseName} onChange={(value) => setField("chineseName", value)} />
                    <LabeledInput label="英文名（必填）" value={draft.englishName} onChange={(value) => setField("englishName", value)} />
                    <div className="space-y-1 text-xs font-semibold text-muted">
                      主 ASIN
                      <div className="flex items-end gap-2">
                        <input
                          className="h-8 w-full max-w-[220px] rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand"
                          value={draft.asin}
                          onChange={(event) => setField("asin", event.target.value)}
                        />
                        <a
                          className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-border px-2.5 text-xs font-semibold ${mainAmazonLink ? "text-brand hover:border-brand" : "pointer-events-none text-muted opacity-50"}`}
                          href={mainAmazonLink || "#"}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          打开主 ASIN
                        </a>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-semibold text-muted">
                        采购价格 CNY
                        <div className="mt-1">
                          <DecimalInput value={draft.purchasePrice} onChange={(value) => setField("purchasePrice", value)} />
                        </div>
                      </label>
                      <label className="text-xs font-semibold text-muted">
                        状态
                        <select
                          className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand"
                          value={draft.status}
                          onChange={(event) => updateStatus(event.target.value as ProductStatus)}
                        >
                          {statusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {draft.status === "canceled" ? (
                      <ConclusionExcelField
                        file={draft.conclusionExcelFile}
                        uploading={conclusionUploading}
                        onUpload={() => conclusionInputRef.current?.click()}
                      />
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ReadonlyField label="选品负责人" value={selectionOwner || "--"} />
                      <ReadonlyField label="当前负责人" value={formatAssigneePreview(workflowAssignee) || "--"} title={workflowAssignee || "--"} />
                    </div>
                    <MultiSelectField label="运营负责人" value={selectedOps} options={opsOptions} onChange={(value) => updateAssigneeList("opsAssignees", value)} />
                    <MultiSelectField label="美工负责人" value={selectedDesigners} options={designerOptions} onChange={(value) => updateAssigneeList("designerAssignees", value)} />
                    <div className="rounded-md border border-border bg-surface-muted px-3 py-3 md:col-span-2 xl:col-span-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-foreground">业务流转</p>
                          <Badge tone={productWorkflowStageTones[workflowStage]}>{productWorkflowStageLabels[workflowStage]}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {workflowOverdue ? "已超 3 天未处理，需要提醒当前负责人。" : "每次流转会自动生成 3 天处理期限。"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={selectedOps.length === 0}
                          onClick={() => moveWorkflow("ops_confirming", "选品提交给运营确认。")} 
                        >
                          <ArrowRight className="h-4 w-4" />
                          交给运营
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={selectedDesigners.length === 0}
                          onClick={() => moveWorkflow("design_in_progress", "运营转交给美工处理。")} 
                        >
                          <ArrowRight className="h-4 w-4" />
                          交给美工
                        </Button>
                        {workflowStage === "design_in_progress" || workflowStage === "design_review" ? (
                          <Button size="sm" variant="secondary" disabled={selectedOps.length === 0} onClick={() => moveWorkflow("ops_confirming", "美工完成后转回运营。")}>
                            <ArrowRight className="h-4 w-4" />
                            转回运营
                          </Button>
                        ) : null}
                        <Button size="sm" variant="secondary" disabled={!canMarkWorkflowDone} onClick={() => moveWorkflow("done", "当前流程已完成。")}>
                          <Save className="h-4 w-4" />
                          标记完成
                        </Button>
                      </div>
                    </div>
                    {!canMarkWorkflowDone ? <p className="mt-2 text-xs text-muted">请先在“运营进度”里完成必填项，再标记业务流转完成。</p> : null}
                    {workflowOverdue ? (
                      <div className="mt-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                        <Bell className="h-4 w-4" />
                        当前阶段已超时，负责人：{workflowAssignee || "未分配"}
                      </div>
                    ) : null}
                    <div className="mt-3 space-y-2">
                      {(draft.workflowHistory ?? []).slice(0, 5).map((event) => (
                        <div key={event.id} className="rounded-md border border-border bg-white px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-bold text-foreground">{event.stageLabel}</p>
                            <span className="text-muted">{formatWorkflowDate(event.createdAt)}</span>
                          </div>
                          <p className="mt-1 text-muted">
                            操作人：{event.actorName || "系统"}
                            {event.assigneeName ? `；负责人：${event.assigneeName}` : ""}
                            {event.note ? `；${event.note}` : ""}
                          </p>
                        </div>
                      ))}
                      {(draft.workflowHistory ?? []).length === 0 ? (
                        <div className="rounded-md border border-border bg-white px-3 py-2 text-xs text-muted">
                          暂无流程记录，保存或点击流转按钮后会生成操作时间和人物。
                        </div>
                      ) : null}
                    </div>
                  </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <ProductWorkbookDetailSections
              detail={workbookDetail}
              onPricingChange={updateWorkbookPricingRow}
              onPricingAdd={addWorkbookPricingRow}
              onPricingRemove={removeWorkbookPricingRow}
              onCompetitorChange={updateWorkbookCompetitor}
              onCompetitorAdd={addWorkbookCompetitor}
              onCompetitorRemove={removeWorkbookCompetitor}
              onSupplierChange={updateWorkbookSupplier}
              onSupplierAdd={addWorkbookSupplier}
              onSupplierRemove={removeWorkbookSupplier}
              onImprovementChange={updateWorkbookImprovement}
              onPeakSeasonWeightsChange={updateWorkbookPeakSeasonWeights}
              onImprovementRowChange={updateWorkbookImprovementRow}
              onKeywordChange={updateWorkbookKeyword}
              onKeywordsReplace={replaceWorkbookKeywords}
              onRemarkChange={(value) => setWorkbookDetail((current) => ({ ...current, remark: value }))}
              onRemarkImagesChange={updateWorkbookRemarkImages}
            />
          </section>
        </div>
      </div>
      {operationsProgressOpen ? (
        <ProductOperationsProgress
          productName={draft.chineseName}
          value={draft.operationsProgress}
          currentUser={creatorName}
          defaultOwner={formatAssigneeList(selectedOps) || selectionOwner}
          onClose={() => setOperationsProgressOpen(false)}
          onApply={(operationsProgress) => {
            setDraft((current) => ({ ...current, operationsProgress }));
            setOperationsProgressOpen(false);
          }}
        />
      ) : null}
      {videoPlanOpen ? (
        <ProductVideoPlanModal
          sku={draft.sku}
          productName={draft.chineseName}
          onClose={() => setVideoPlanOpen(false)}
        />
      ) : null}
      {previewImage ? (
        <ProductImagePreviewModal
          image={previewImage}
          loading={previewLoading}
          onClose={() => setPreviewImage(null)}
          onLoad={() => setPreviewLoading(false)}
        />
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "gray",
  active,
  detail,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "gray" | "blue" | "green" | "amber" | "red";
  active?: boolean;
  detail?: string;
  onClick?: () => void;
}) {
  const toneClass = {
    gray: "text-foreground",
    blue: "text-info",
    green: "text-success",
    amber: "text-accent",
    red: "text-danger",
  }[tone];

  return (
    <button
      className={`flex min-h-[82px] w-32 flex-col rounded-md border bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-brand hover:bg-surface-muted ${
        active ? "border-brand ring-2 ring-brand/15" : "border-border"
      }`}
      onClick={onClick}
      type="button"
    >
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-xl font-black metric-tabular ${toneClass}`}>{value}</p>
      {detail ? <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted">{detail}</p> : null}
    </button>
  );
}

async function loadTeamAccountsFromApi() {
  try {
    const data = await fetchTeamAccountsCached();
    return data.accounts;
  } catch {
    return [];
  }
}

function getTeamMemberOptions(members: TeamMember[], roles: ProductWorkflowRole[]) {
  return Array.from(new Set(filterTeamMembersByRoles(members, roles).map((member) => member.name.trim()).filter(Boolean)));
}

function getAccountNameOptionsByRoleIds(accounts: TeamAccountRecord[], roleIds: AccountRoleId[]) {
  const roleSet = new Set<AccountRoleId>(roleIds);
  const names = accounts
    .filter((account) => account.status !== "disabled" && account.status !== "archived" && roleSet.has(account.roleId))
    .map((account) => account.name.trim())
    .filter(Boolean);

  return Array.from(new Set(names));
}

function Pagination({
  page,
  pageCount,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        上一页
      </Button>
      <span className="rounded-md bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
        {page} / {pageCount}
      </span>
      <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        下一页
      </Button>
      <select
        className="h-8 rounded-md border border-border bg-white px-2 text-xs font-semibold text-foreground"
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
      >
        {pageSizeOptions.map((option) => (
          <option key={option} value={option}>
            {option} 条 / 页
          </option>
        ))}
      </select>
    </div>
  );
}
