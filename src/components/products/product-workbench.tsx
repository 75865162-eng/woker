"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, ChevronDown, ExternalLink, FileDown, FileUp, History, ImagePlus, Minus, PackagePlus, RotateCcw, Save, Search, Video, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { newProductStatusOptions, productStatusOptions } from "@/data/products";
import {
  accountsToTeamMembers,
  type AccountRoleId,
  filterTeamMembersByRoles,
  normalizeTeamAccounts,
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

import {
  initialFilters,
  pageSizeOptions,
  scalarImprovementFields,
  supplierFields,
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
  getSupplierTextareaSize,
} from "./product-workbook-detail-sections";
import { ProductImageCopyGalleryModal } from "./product-image-copy-gallery-modal";
import { ProductVideoPlanModal } from "./product-video-plan-modal";
import { DecimalInput, ExternalLinkButton, LabeledInput, ReadonlyMetric, SmallInput, SmallTextarea } from "./product-workbench-fields";
import { ActivityLogModal, ProductFiltersBar, ProductTable } from "./product-workbench-shell";
import { ProductOperationsProgress } from "./product-operations-progress";
import {
  buildAmazonLink,
  calculateTrialPricing,
  formatDateTime,
  nextSku as getNextSku,
} from "./product-workbench-utils";
import {
  createTrialProductDraft,
  createProductShellFromListItem,
  parseProductWorkbookFile,
  productToDraft,
  trialImprovementLabels,
} from "./product-workbench-data";

type ProductWorkbenchCache = {
  products: Product[];
  filters: ProductFilters;
  page: number;
  pageSize: number;
  totalCount: number;
  summary: ProductListSummary;
};

const productWorkbenchStorageKeyPrefix = "amazon-product-workbench-cache-v4";
let productWorkbenchCache: ProductWorkbenchCache | null = null;
let productWorkbenchCacheWorkspaceId: string | null = null;
const productDetailCache = new Map<string, Product>();
const productDetailInflight = new Map<string, Promise<Product>>();
const compactToolbarButtonClass =
  "shrink-0 whitespace-nowrap max-sm:h-7 max-sm:px-2 max-sm:text-[10px] max-sm:leading-none max-sm:gap-1";
const competitorTableFields: Array<Exclude<keyof TrialCompetitorRow, "hotVariantImageAsset" | "noteImageAsset">> = [
  "type",
  "hotVariantImage",
  "asin",
  "sales30Days",
  "variantCount",
  "variantType",
  "hotVariantSpec",
  "hotVariantPrice",
  "fbaFee",
  "priceChangeNote",
  "reviewCount",
  "rating",
  "negativePoint1",
  "negativePoint2",
  "negativePoint3",
  "negativePoint4",
  "negativePoint5",
  "packageSize",
  "note",
  "noteImage",
];

type ProductListSummary = {
  total: number;
  developing: number;
  opsReview: number;
  designInProgress: number;
  operationsProgress: number;
  overdue: number;
};

const emptyProductListSummary: ProductListSummary = {
  total: 0,
  developing: 0,
  opsReview: 0,
  designInProgress: 0,
  operationsProgress: 0,
  overdue: 0,
};

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

    for (const product of parsed.products) {
      if (hasWorkbookDetail(product)) {
        productDetailCache.set(getProductDetailCacheKeyWithMode(workspaceId, product.sku, true), product);
      }
    }
    const nextCache = {
      ...parsed,
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

export function ProductWorkbench() {
  const initialCachedWorkbench = readCachedProductWorkbench();
  const [products, setProducts] = useState<Product[]>(() => initialCachedWorkbench?.products ?? []);
  const [, setTrialProducts] = useState<TrialProductDraft[]>([]);
  const [filters, setFilters] = useState<ProductFilters>(() => normalizeProductFilters(initialCachedWorkbench?.filters));
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [detailReady, setDetailReady] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isTrialEditorOpen, setIsTrialEditorOpen] = useState(false);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [versionProduct, setVersionProduct] = useState<Product | null>(null);
  const [page, setPage] = useState(() => initialCachedWorkbench?.page ?? 1);
  const [pageSize, setPageSize] = useState(() => initialCachedWorkbench?.pageSize ?? 20);
  const [productsTotalCount, setProductsTotalCount] = useState(() => initialCachedWorkbench?.totalCount ?? 0);
  const [listSummary, setListSummary] = useState<ProductListSummary>(() => initialCachedWorkbench?.summary ?? emptyProductListSummary);
  const [summaryReady, setSummaryReady] = useState(() => Boolean(initialCachedWorkbench));
  const [mySkuCount, setMySkuCount] = useState(0);
  const [mySkuReady, setMySkuReady] = useState(false);
  const [activityLog, setActivityLog] = useState<string[]>(["产品工作台已连接数据库"]);
  const [productsLoading, setProductsLoading] = useState(() => !initialCachedWorkbench);
  const [productsError, setProductsError] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const productsRequestSeq = useRef(0);
  const summaryRequestSeq = useRef(0);
  const productDetailRequestSeq = useRef(0);
  const productsRef = useRef(products);
  const filtersRef = useRef(filters);
  const pageRef = useRef(page);
  const pageSizeRef = useRef(pageSize);
  const productsTotalCountRef = useRef(productsTotalCount);
  const listSummaryRef = useRef(listSummary);
  const [teamAccounts, setTeamAccounts] = useState<TeamAccountRecord[]>([]);
  const [creatorName, setCreatorName] = useState("当前创建人");
  const currentUserName = creatorName === "当前创建人" ? "" : creatorName.trim();
  const teamMembers = useMemo(() => accountsToTeamMembers(teamAccounts), [teamAccounts]);
  const opsOptions = useMemo(() => getTeamMemberOptions(teamMembers, ["operations_supervisor", "operations"]), [teamMembers]);
  const designerOptions = useMemo(() => getTeamMemberOptions(teamMembers, ["designer"]), [teamMembers]);
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
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { user?: { name?: string } } | null) => {
        if (data?.user?.name) {
          setCreatorName(data.user.name);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadTeamAccounts() {
      const apiAccounts = await loadTeamAccountsFromApi();
      if (canceled) return;

      setTeamAccounts(apiAccounts);
    }

    void loadTeamAccounts();

    return () => {
      canceled = true;
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
    const params = new URLSearchParams({
      page: String(input.page),
      pageSize: String(input.pageSize),
      detail: input.detail === false ? "list" : "full",
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

    const response = await fetch(`/api/products?${params.toString()}`, { cache: "no-store", signal: input.signal });
    const data = (await response.json()) as {
      products?: ProductListItem[];
      pagination?: { total?: number; pageCount?: number };
      summary?: ProductListSummary;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "商品数据读取失败");
    }

    return data;
  }, []);

  const loadProductSummary = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++summaryRequestSeq.current;
    const requestSignal = signal ?? new AbortController().signal;

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
        return;
      }

      if (!response.ok || !data.summary) {
        throw new Error(data.error || "商品统计读取失败");
      }

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
    } catch (error) {
      if (requestSignal.aborted || requestId !== summaryRequestSeq.current) {
        return;
      }

      setSummaryReady(true);
      const message = error instanceof Error ? error.message : "商品统计读取失败";
      setActivityLog((current) => [`商品统计读取失败：${message}`, ...current].slice(0, 8));
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

    void (async () => {
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
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [currentUserName, fetchProducts]);

  useEffect(() => {
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
            includeSummary: false,
            detail: false,
            signal: controller.signal,
          });

          if (controller.signal.aborted || requestId !== productsRequestSeq.current) {
            return;
          }

          const nextProducts = Array.isArray(data.products)
            ? data.products.map((product) => createProductShellFromListItem(product))
            : [];
          const nextTotalCount = data.pagination?.total ?? 0;

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
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [fetchProducts, filters, loadProductSummary, page, pageSize]);

  const loadProductDetail = useCallback(async (sku: string, signal?: AbortSignal, options?: { includeWorkbookImages?: boolean }) => {
    const normalizedSku = sku.trim();
    const workspaceId = readCurrentWorkspaceId();
    const includeWorkbookImages = options?.includeWorkbookImages ?? true;
    const cacheKey = getProductDetailCacheKeyWithMode(workspaceId, normalizedSku, includeWorkbookImages);
    const cached = productDetailCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = productDetailInflight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      const params = new URLSearchParams();
      if (!includeWorkbookImages) {
        params.set("includeWorkbookImages", "false");
      }

      const response = await fetch(`/api/products/${encodeURIComponent(normalizedSku)}${params.toString() ? `?${params.toString()}` : ""}`, {
        cache: "no-store",
        signal,
      });
      const data = (await response.json()) as { product?: Product; error?: string };

      if (!response.ok || !data.product) {
        throw new Error(data.error || "商品详情读取失败");
      }

      productDetailCache.set(cacheKey, data.product);
      return data.product;
    })();

    productDetailInflight.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      productDetailInflight.delete(cacheKey);
    }
  }, []);

  useEffect(() => {
    if (!products.length) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const uniqueSkus = Array.from(new Set(products.map((product) => product.sku.trim()).filter(Boolean)));
      const skusToPrefetch = uniqueSkus.filter((sku) => {
        const fullCachedProduct = productDetailCache.get(getProductDetailCacheKeyWithMode(readCurrentWorkspaceId(), sku, true));
        const cachedProduct = productDetailCache.get(getProductDetailCacheKeyWithMode(readCurrentWorkspaceId(), sku, false));
        return !cachedProduct && !fullCachedProduct;
      });

      if (!skusToPrefetch.length) {
        return;
      }

      const queue = [...skusToPrefetch];
      const concurrency = Math.min(4, queue.length);
      const workers = Array.from({ length: concurrency }, async () => {
        while (!controller.signal.aborted) {
          const sku = queue.shift();
          if (!sku) {
            return;
          }

          await loadProductDetail(sku, controller.signal, { includeWorkbookImages: false }).catch(() => undefined);
        }
      });

      void Promise.all(workers).catch(() => undefined);
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loadProductDetail, products]);

  function prefetchProductDetail(sku: string) {
    void loadProductDetail(sku, undefined, { includeWorkbookImages: false }).catch(() => undefined);
  }

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
        includeSummary: false,
        detail: false,
        signal: controller.signal,
      });
      const nextProducts = Array.isArray(data.products)
        ? data.products.map((product) => createProductShellFromListItem(product))
        : [];
      const nextTotalCount = data.pagination?.total ?? 0;
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
    const requestId = ++productDetailRequestSeq.current;
    const cachedDetail = productDetailCache.get(fullCacheKey);
    const cachedTextDetail = productDetailCache.get(textCacheKey);
    const listProduct = productsRef.current.find((product) => product.sku.trim() === normalizedSku) ?? null;

    setProductsError("");
    setActiveProduct(cachedDetail ?? cachedTextDetail ?? listProduct);
    setDetailReady(Boolean(cachedDetail));
    setIsEditorOpen(true);

    if (cachedDetail) {
      setActiveProduct(cachedDetail);
      setDetailReady(true);
      return;
    }

    try {
      const product = await loadProductDetail(normalizedSku, undefined, { includeWorkbookImages: true });
      if (requestId !== productDetailRequestSeq.current) {
        return;
      }
      setActiveProduct(product);
      setDetailReady(true);
    } catch (error) {
      if (requestId !== productDetailRequestSeq.current) {
        return;
      }
      const message = error instanceof Error ? error.message : "商品详情读取失败";
      setProductsError(message);
      setActivityLog((current) => [`商品详情读取失败：${message}`, ...current].slice(0, 8));
    } finally {
      setIsEditorOpen(true);
    }
  }

  async function persistProduct(product: Product) {
    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product }),
    });
    const data = (await response.json()) as { product?: Product; error?: string };

    if (!response.ok || !data.product) {
      throw new Error(data.error || "商品保存失败");
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
      productDetailCache.set(getProductDetailCacheKeyWithMode(readCurrentWorkspaceId(), savedProduct.sku, true), savedProduct);
      setActiveProduct(savedProduct);
      setDetailReady(true);
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
      window.alert(message);
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

  async function handleExportProducts() {
    try {
      const params = new URLSearchParams({
        search: filters.keyword.trim(),
        asin: filters.asin.trim(),
        supplierName: filters.supplierName.trim(),
        status: filters.status,
        opsAssignees: filters.opsAssignees.join(","),
        selectionOwners: filters.selectionOwners.join(","),
        designerAssignees: filters.designerAssignees.join(","),
        mySkuOwner: filters.mySkuOwner.trim(),
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
        const anchor = document.createElement("a");
        anchor.href = data.file.downloadUrl;
        anchor.download = data.file.name ?? "products.csv";
        anchor.click();
        setActivityLog((current) => [`商品导出已完成并生成文件 ${data.file?.name ?? "products.csv"}`, ...current].slice(0, 8));
        return;
      }

      setActivityLog((current) => [`商品导出任务已提交到任务中心，完成后可下载 ${data.job?.file?.originalName ?? "products.csv"}`, ...current].slice(0, 8));
    } catch (error) {
      const message = error instanceof Error ? error.message : "商品导出失败";
      setActivityLog((current) => [`商品导出失败：${message}`, ...current].slice(0, 8));
      window.alert(message);
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
            label="确认上架"
            value={summaryValue(listingConfirmingCount)}
            tone="amber"
            active={filters.status === "listing_confirming"}
            onClick={() => patchFilters((current) => ({ ...current, status: "listing_confirming" }))}
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
          顶部卡片按业务阶段聚合统计，开发中会合并待开发与开发中，确认上架单独统计，超期和我的SKU可以与其它卡片重叠。
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
              <Button variant="secondary" size="sm" onClick={() => void handleExportProducts()}>
                <FileDown className="h-4 w-4" />
                导出数据
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
              onPrefetchProduct={(sku) => {
                prefetchProductDetail(sku);
              }}
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
          <TrialProductEditor
            onClose={() => setIsTrialEditorOpen(false)}
            onSave={handleSaveTrialProduct}
          />
        ) : null}
      </div>
    </>
  );
}

type ProductVersionRecord = {
  id: string;
  version: number;
  action: string;
  summary?: string | null;
  createdAt: string;
  userId?: string | null;
};

function ProductVersionModal({
  product,
  onClose,
  onRestored,
}: {
  product: Product;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<ProductVersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        entityType: "product",
        entityId: product.sku,
        pageSize: "50",
      });
      const response = await fetch(`/api/audit/versions?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as { versions?: ProductVersionRecord[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "版本历史读取失败。");
      }

      setVersions(Array.isArray(data.versions) ? data.versions : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "版本历史读取失败。");
    } finally {
      setLoading(false);
    }
  }, [product.sku]);

  async function restoreVersion(version: ProductVersionRecord) {
    if (!window.confirm(`确定恢复 ${product.sku} 到版本 ${version.version} 吗？`)) {
      return;
    }

    setBusyId(version.id);
    setError("");

    try {
      const response = await fetch("/api/audit/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "版本恢复失败。");
      }

      onRestored();
      await loadVersions();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "版本恢复失败。");
    } finally {
      setBusyId("");
    }
  }

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-6 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">版本历史：{product.sku}</h3>
            <p className="mt-1 text-xs font-semibold text-muted">{product.chineseName || product.englishName || "未命名商品"}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
            关闭
          </Button>
        </div>
        <div className="thin-scrollbar flex-1 space-y-3 overflow-y-auto p-5">
          {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
          {loading ? <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm font-semibold text-muted">正在读取版本历史...</div> : null}
          {versions.map((version) => (
            <div key={version.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">版本 {version.version} · {version.action}</p>
                <p className="mt-1 truncate text-xs font-medium text-muted">{version.summary || "无摘要"} · {new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void restoreVersion(version)} disabled={Boolean(busyId)}>
                <RotateCcw className="h-4 w-4" />
                {busyId === version.id ? "恢复中" : "恢复"}
              </Button>
            </div>
          ))}
          {!loading && versions.length === 0 ? (
            <p className="rounded-md border border-border bg-surface-muted px-3 py-8 text-center text-sm font-medium text-muted">这个商品还没有版本记录。</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TrialProductEditor({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (draft: TrialProductDraft) => void;
}) {
  const [draft, setDraft] = useState<TrialProductDraft>(() => createTrialProductDraft());

  function updatePricingRow(index: number, field: keyof TrialPriceRow, value: string | number) {
    setDraft((current) => ({
      ...current,
      pricingRows: current.pricingRows.map((row, rowIndex) =>
        rowIndex === index
          ? { ...row, [field]: field === "name" ? String(value) : typeof value === "number" ? value : Number(value) || 0 }
          : row,
      ),
    }));
  }

  function updateCompetitor(index: number, field: keyof TrialCompetitorRow, value: string) {
    setDraft((current) => ({
      ...current,
      competitors: current.competitors.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    }));
  }

  function updateSupplier(index: number, field: keyof TrialSupplierRow, value: string | number) {
    setDraft((current) => ({
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

  function updateImprovement(field: Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">, value: string) {
    setDraft((current) => ({
      ...current,
      improvement: { ...current.improvement, [field]: value },
    }));
  }

  function updateKeyword(index: number, field: keyof TrialKeywordRow, value: string | number) {
    setDraft((current) => ({
      ...current,
      keywords: current.keywords.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: field === "keyword" ? String(value) : typeof value === "number" ? value : Number(value) || 0,
            }
          : row,
      ),
    }));
  }

  function handleSubmit() {
    const hasName = draft.title.trim() || draft.pricingRows.some((row) => row.name.trim());
    if (!hasName) {
      window.alert("请至少填写试算商品名称。");
      return;
    }

    onSave({
      ...draft,
      title: draft.title.trim() || draft.pricingRows[0]?.name.trim() || "未命名试算商品",
    });
  }

  return (
    <div className="fixed inset-0 z-30 bg-foreground/35 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">新增试算商品</h2>
            <p className="mt-1 text-xs font-medium text-muted">按 Excel 试算表拆分为利润试算、竞品、供应商、改进点和关键词区域。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
              取消
            </Button>
            <Button size="sm" onClick={handleSubmit}>
              <Save className="h-4 w-4" />
              保存
            </Button>
          </div>
        </div>

        <div className="thin-scrollbar flex-1 space-y-5 overflow-auto p-5">
          <Card>
            <CardHeader>
              <CardTitle>试算商品标题</CardTitle>
            </CardHeader>
            <CardContent>
              <LabeledInput label="试算商品名称" value={draft.title} placeholder="例如：交易卡展示" onChange={(value) => setDraft((current) => ({ ...current, title: value }))} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>区域 1：利润试算</CardTitle>
            </CardHeader>
            <CardContent className="thin-scrollbar overflow-auto">
              <table className="min-w-[1760px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    {["品名", "长 cm", "宽 cm", "高 cm", "实际重量 g", "材积重量 g", "建议售价(USD)", "采购成本(RMB)", "FBA配送费$", "3.5% 燃油及物流附加费(USD)", "海运单价(RMB)", "海运头程(RMB)", "佣金(USD)", "月仓储费(USD)", "汇率", "保本价(USD)", "海运毛利(USD)", "海运毛利率", "体积重量/", "重量/"].map((label) => (
                      <th key={label} className="px-2 py-2 font-bold">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.pricingRows.map((row, index) => {
                    const calc = calculateTrialPricing(row);
                    return (
                      <tr key={index} className="border-t border-border align-top">
                        <td className="px-2 py-2"><SmallInput value={row.name} onChange={(value) => updatePricingRow(index, "name", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.lengthCm} onChange={(value) => updatePricingRow(index, "lengthCm", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.widthCm} onChange={(value) => updatePricingRow(index, "widthCm", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.heightCm} onChange={(value) => updatePricingRow(index, "heightCm", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.actualWeightKg} onChange={(value) => updatePricingRow(index, "actualWeightKg", value)} /></td>
                    <ReadonlyMetric value={calc.volumeWeightKg} />
                    <td className="px-2 py-2"><DecimalInput compact value={row.suggestedPrice} onChange={(value) => updatePricingRow(index, "suggestedPrice", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.purchaseCost} onChange={(value) => updatePricingRow(index, "purchaseCost", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.fbaFee} onChange={(value) => updatePricingRow(index, "fbaFee", value)} /></td>
                    <ReadonlyMetric value={calc.fuelFee} />
                    <td className="px-2 py-2"><DecimalInput compact value={row.oceanFreightUnitPrice} onChange={(value) => updatePricingRow(index, "oceanFreightUnitPrice", value)} /></td>
                    <ReadonlyMetric value={calc.oceanFreight} />
                    <ReadonlyMetric value={calc.commission} />
                    <ReadonlyMetric value={calc.monthlyStorageFee} />
                    <td className="px-2 py-2"><DecimalInput compact value={row.exchangeRate} onChange={(value) => updatePricingRow(index, "exchangeRate", value)} /></td>
                    <ReadonlyMetric value={calc.breakEvenPrice} />
                    <ReadonlyMetric value={calc.profit} />
                        <ReadonlyMetric value={`${(calc.profitRate * 100).toFixed(1)}%`} />
                        <ReadonlyMetric value={calc.volumeWeightLb} />
                        <ReadonlyMetric value={calc.actualWeightLb} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>区域 2：竞品分析</CardTitle>
            </CardHeader>
            <CardContent className="thin-scrollbar overflow-auto">
              <table className="min-w-[1560px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    {["类型", "ASIN", "近30天销量", "变体数量", "变体类型", "热销变体规格", "热销变体价格($)", "FBA费用($)", "近3个月价格变动备注", "评论数", "评分", "差评点1", "差评点2", "差评点3", "差评点4", "差评点5", "竞品包装尺寸", "备注"].map((label) => (
                      <th key={label} className="px-2 py-2 font-bold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.competitors.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {competitorTableFields.map((field) => (
                        <td key={field} className="px-2 py-2">
                          <SmallInput value={String(row[field] ?? "")} onChange={(value) => updateCompetitor(index, field, value)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>区域 3：供应商报价</CardTitle>
            </CardHeader>
            <CardContent className="thin-scrollbar overflow-auto">
              <table className="min-w-[1420px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    {["供应商产品链路", "厂家名称", "配置", "起订量", "交期", "国内物流费", "相关认证", "专利国家", "产品包装方式", "采购成本(100套)", "采购成本(300)", "开票信息", "备注"].map((label) => (
                      <th key={label} className="px-2 py-2 font-bold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.suppliers.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {supplierFields.map((field) => (
                        <td key={field} className="px-2 py-2">
                          {field === "productUrl" ? (
                            <div className="flex gap-2">
                              <SmallTextarea size="supplierWide" value={row[field]} onChange={(value) => updateSupplier(index, field, value)} />
                              <ExternalLinkButton href={row[field]} />
                            </div>
                          ) : (
                            <SmallTextarea
                              size={getSupplierTextareaSize(field)}
                              value={row[field]}
                              onChange={(value) => updateSupplier(index, field, value)}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>区域 4：产品改进点</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {scalarImprovementFields.map((field) => (
                <LabeledInput key={field} label={trialImprovementLabels[field]} value={draft.improvement[field]} onChange={(value) => updateImprovement(field, value)} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>区域 5：关键词</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="thin-scrollbar overflow-auto">
                <table className="min-w-[640px] text-left text-xs">
                  <thead className="bg-surface-muted text-muted">
                    <tr>
                      <th className="px-2 py-2">关键词</th>
                      <th className="px-2 py-2">CPC</th>
                      <th className="px-2 py-2">月搜索量</th>
                      <th className="px-2 py-2">ABA周排名</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.keywords.map((row, index) => (
                      <tr key={index} className="border-t border-border">
                        <td className="px-2 py-2"><SmallInput value={row.keyword} onChange={(value) => updateKeyword(index, "keyword", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput value={row.cpc} onChange={(value) => updateKeyword(index, "cpc", value)} /></td>
                    <td className="px-2 py-2"><SmallInput type="number" value={row.monthlySearches} onChange={(value) => updateKeyword(index, "monthlySearches", value)} /></td>
                    <td className="px-2 py-2"><SmallInput type="number" value={row.abaRank} onChange={(value) => updateKeyword(index, "abaRank", value)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="block text-xs font-semibold text-muted">
                备注
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                  value={draft.remark}
                  onChange={(event) => setDraft((current) => ({ ...current, remark: event.target.value }))}
                />
              </label>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
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
  onSave: (draft: ProductDraft) => void;
}) {
  const [draft, setDraft] = useState<ProductEditorDraft>(() => productToDraft(product, products, nextSku));
  const [operationsProgressOpen, setOperationsProgressOpen] = useState(false);
  const [imageCopyGalleryOpen, setImageCopyGalleryOpen] = useState(false);
  const [videoPlanOpen, setVideoPlanOpen] = useState(false);
  const [conclusionUploading, setConclusionUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const conclusionInputRef = useRef<HTMLInputElement | null>(null);
  const productRef = useRef(product);
  const productsRef = useRef(products);
  const nextSkuRef = useRef(nextSku);

  const isEditing = Boolean(product);
  const showHeavyDetail = !isEditing || detailReady;
  const mainAmazonLink = buildAmazonLink(draft.asin);
  const workbookDetail = draft.workbookDetail;
  const primaryImageAsset = draft.imageAssets?.[0];
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
    if (!isEditing || !detailReady) {
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
      actorName: draft.selectionOwner || creatorName,
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
            actorName: selectionOwner,
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

    await saveDraft(nextDraft);
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

  function updateWorkbookCompetitor(index: number, field: keyof TrialCompetitorRow, value: string) {
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
          return { ...nextRow, hotVariantImageAsset: undefined };
        }

        if (field === "noteImage") {
          return { ...nextRow, noteImageAsset: undefined };
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

  function handleImageUpload(files: FileList | null) {
    const selected = Array.from(files ?? []).slice(0, 10 - draft.images.length);
    if (!selected.length) {
      return;
    }

    void Promise.all(selected.map(uploadProductImageFile))
      .then((images) => {
        setDraft((current) => ({
          ...current,
          images: [...current.images, ...images.map((image) => image.thumbUrl)].slice(0, 10),
          imageAssets: [...(current.imageAssets ?? []), ...images].slice(0, 10),
        }));
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : "商品图片上传失败。");
      });
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
                    <Button variant="secondary" size="sm" className={compactToolbarButtonClass} onClick={() => setImageCopyGalleryOpen(true)}>
                      图片文案
                    </Button>
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
            <Button size="sm" className={compactToolbarButtonClass} onClick={() => handleSubmit()}>
              <Save className="h-4 w-4" />
              保存
            </Button>
          </div>
        </div>

        <div className="thin-scrollbar flex-1 overflow-auto p-5">
          <section className="space-y-4">
            <Card>
              <CardContent className="grid gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div>
                  <h3 className="text-lg font-bold text-foreground">图片</h3>
                  {primaryImageAsset ? (
                    <button
                      type="button"
                      className="mt-4 flex aspect-square w-full overflow-hidden rounded-lg border border-border bg-surface-muted transition-colors hover:border-brand hover:bg-white"
                      onClick={() => setPreviewImage(primaryImageAsset.originalUrl || primaryImageAsset.thumbUrl)}
                      title="点击查看大图"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={primaryImageAsset.thumbUrl || primaryImageAsset.originalUrl} alt="商品主图预览" className="h-full w-full object-contain p-2" />
                    </button>
                  ) : (
                    <label className="mt-4 flex aspect-square w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted text-center transition-colors hover:border-brand hover:bg-white">
                      <ImagePlus className="h-8 w-8 text-brand" />
                      <span className="mt-2 text-sm font-semibold text-foreground">上传图片</span>
                      <span className="mt-1 text-xs text-muted">可上传 5-10 张，第一张会显示为主图。</span>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleImageUpload(event.target.files)} />
                    </label>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-center transition-colors hover:border-brand hover:bg-white">
                      <div className="flex flex-col items-center justify-center">
                        <ImagePlus className="h-4 w-4 text-brand" />
                        <span className="mt-1 text-[10px] font-semibold text-foreground">上传</span>
                      </div>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleImageUpload(event.target.files)} />
                    </label>
                    <div className="thin-scrollbar flex max-w-full gap-2 overflow-x-auto pb-1">
                      {draft.imageAssets?.map((asset, index) => (
                        <div key={`${asset.id || asset.thumbUrl.slice(0, 24)}-${index}`} className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted"
                            onClick={() => setPreviewImage(asset.originalUrl || asset.thumbUrl)}
                            title="点击查看大图"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={asset.thumbUrl || asset.originalUrl} alt={`商品图片 ${index + 1}`} className="h-full w-full object-contain p-1" />
                          </button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            title="删除图片"
                            onClick={() => removeImage(index)}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

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
      {imageCopyGalleryOpen ? (
        <ProductImageCopyGalleryModal
          sku={draft.sku}
          productName={draft.chineseName}
          onClose={() => setImageCopyGalleryOpen(false)}
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/40 p-6 backdrop-blur-sm" onClick={() => setPreviewImage(null)}>
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">图片预览</h3>
                <p className="mt-1 text-xs font-semibold text-muted">点击空白处或关闭按钮返回。</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setPreviewImage(null)}>
                <X className="h-4 w-4" />
                关闭
              </Button>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto p-5" onClick={() => setPreviewImage(null)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewImage} alt="商品图片大图" className="max-h-[78vh] max-w-full object-contain" onClick={(event) => event.stopPropagation()} />
            </div>
          </div>
        </div>
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

function ConclusionExcelField({
  file,
  uploading,
  onUpload,
}: {
  file?: Product["conclusionExcelFile"];
  uploading: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="text-xs font-semibold text-muted">
      <p>结论 Excel 表（必传）</p>
      <div className="mt-1 flex min-h-10 items-center justify-between gap-2 rounded-md border border-border bg-white px-3 py-2">
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${file ? "text-foreground" : "text-danger"}`}>
            {file?.name || "未上传"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {file ? `${formatFileSize(file.size)} · ${file.storageType}` : "已取消或确认上架前必须上传"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {file?.downloadUrl ? (
            <a className="text-xs font-bold text-brand hover:underline" href={file.downloadUrl}>
              下载
            </a>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onUpload} disabled={uploading}>
            <FileUp className="h-4 w-4" />
            {uploading ? "上传中" : file ? "替换" : "上传"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function ReadonlyField({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="text-xs font-semibold text-muted">
      {label}
      <div className="mt-1 flex h-10 w-full items-center rounded-md border border-border bg-surface-muted px-3 text-sm font-semibold text-foreground" title={title ?? value}>
        {value || "--"}
      </div>
    </div>
  );
}

function MultiSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draftValue, setDraftValue] = useState<string[]>(value);
  const [panelStyle, setPanelStyle] = useState<{
    position: "fixed";
    top: number;
    left: number;
    width: number;
    zIndex: number;
  }>({
    position: "fixed",
    top: 0,
    left: 0,
    width: 0,
    zIndex: 60,
  });

  const filteredOptions = useMemo(() => {
    const uniqueOptions = Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return uniqueOptions;
    return uniqueOptions.filter((option) => option.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  const normalizedValue = useMemo(() => Array.from(new Set(value.map((item) => item.trim()).filter(Boolean))), [value]);
  const selectedCount = normalizedValue.length;
  const triggerText = selectedCount ? normalizedValue.join("、") : "请选择";
  const allVisibleSelected = filteredOptions.length > 0 && filteredOptions.every((option) => draftValue.includes(option));
  const visibleSelectedCount = filteredOptions.filter((option) => draftValue.includes(option)).length;

  useEffect(() => {
    if (open) {
      setDraftValue(normalizedValue);
      setQuery("");
    }
  }, [normalizedValue, open]);

  useEffect(() => {
    if (!open) return;

    function updatePanelPosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      setPanelStyle({
        position: "fixed",
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
        zIndex: 60,
      });
    }

    function handleOutsidePointer(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggle(option: string) {
    setDraftValue((current) => (current.includes(option) ? current.filter((item) => item !== option) : [...current, option]));
  }

  function toggleAllVisible() {
    if (!filteredOptions.length) return;

    setDraftValue((current) =>
      allVisibleSelected ? current.filter((item) => !filteredOptions.includes(item)) : Array.from(new Set([...current, ...filteredOptions])),
    );
  }

  function commit() {
    onChange(Array.from(new Set(draftValue.map((item) => item.trim()).filter(Boolean))));
    setOpen(false);
  }

  function cancel() {
    setDraftValue(normalizedValue);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative text-xs font-semibold text-muted">
      <p>{label}</p>
      <button
        ref={triggerRef}
        type="button"
        className={`mt-1 flex h-10 w-full items-center justify-between gap-3 rounded-md border bg-white px-3 text-left text-sm outline-none transition-colors focus:border-brand ${
          open ? "border-brand ring-2 ring-brand/15" : "border-border"
        }`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedCount ? "text-foreground" : "text-muted"}`}>{triggerText}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div style={panelStyle} className="rounded-lg border border-border bg-white shadow-2xl">
          <div className="border-b border-border px-3 py-3">
            <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-white px-3 text-sm text-foreground focus-within:border-brand">
              <Search className="h-4 w-4 shrink-0 text-muted" />
              <input
                className="w-full bg-transparent outline-none placeholder:text-muted"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索"
              />
              {query ? (
                <button
                  type="button"
                  className="shrink-0 text-muted hover:text-foreground"
                  onClick={() => setQuery("")}
                  aria-label="清空搜索"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
          </div>

          <div className="thin-scrollbar max-h-64 overflow-auto px-3 py-2">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-surface-muted"
              onClick={toggleAllVisible}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-sm border ${allVisibleSelected ? "border-brand bg-brand text-white" : "border-border bg-white"}`}>
                {allVisibleSelected ? <span className="text-[11px] font-bold leading-none">✓</span> : null}
              </span>
              <span className="text-sm font-semibold text-foreground">全选</span>
              <span className="ml-auto text-xs font-medium text-muted">
                {filteredOptions.length ? `${visibleSelectedCount}/${filteredOptions.length}` : "无匹配"}
              </span>
            </button>

            <div className="mt-1 space-y-1">
              {filteredOptions.length ? (
                filteredOptions.map((option) => {
                  const checked = draftValue.includes(option);

                  return (
                    <button
                      key={option}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-surface-muted"
                      onClick={() => toggle(option)}
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded-sm border ${checked ? "border-brand bg-brand text-white" : "border-border bg-white"}`}>
                        {checked ? <span className="text-[11px] font-bold leading-none">✓</span> : null}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-sm ${checked ? "font-bold text-foreground" : "font-medium text-foreground"}`}>{option}</span>
                    </button>
                  );
                })
              ) : (
                <p className="px-1 py-8 text-center text-xs font-medium text-muted">暂无匹配结果</p>
              )}
            </div>
          </div>

          <div className="border-t border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted">按住 Shift 可快速多选</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={cancel}>
                  取消
                </Button>
                <Button size="sm" onClick={commit}>
                  确定
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

async function loadTeamAccountsFromApi() {
  try {
    const response = await fetch("/api/accounts/team-members");
    if (!response.ok) return [];

    const data = (await response.json()) as { accounts?: unknown };
    return normalizeTeamAccounts(data.accounts);
  } catch {
    return [];
  }
}

async function uploadProductImageFile(file: File): Promise<ProductImageAsset> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/products/image-assets/upload", {
    method: "POST",
    body: formData,
  });
  const data = (await response.json()) as {
    asset?: ProductImageAsset & { url?: string };
    error?: string;
  };

  if (!response.ok || !data.asset?.url || !data.asset?.originalUrl) {
    throw new Error(data.error || "商品图片上传失败。");
  }

  return {
    ...data.asset,
    thumbUrl: data.asset.thumbUrl || data.asset.url,
  };
}

async function uploadEmbeddedProductImages(product: Product) {
  const productWithWorkbook = product as Product & { workbookDetail?: TrialProductDraft };
  const sourceImages = Array.isArray(product.images) ? product.images.filter((image) => image.trim()) : [];
  const uploadedImages = await Promise.all(sourceImages.map((image, index) => uploadDataUrlImage(image, `${product.sku || "product"}-${index + 1}.png`)));
  const sourceRemarkImages = Array.isArray(productWithWorkbook.workbookDetail?.remarkImages)
    ? productWithWorkbook.workbookDetail.remarkImages.filter((image) => image.trim())
    : [];
  const uploadedRemarkImages = await Promise.all(sourceRemarkImages.map((image, index) => uploadDataUrlImage(image, `${product.sku || "product"}-remark-${index + 1}.png`)));
  const workbookDetail = productWithWorkbook.workbookDetail
    ? {
        ...productWithWorkbook.workbookDetail,
        remarkImages: uploadedRemarkImages.map((asset) => asset.thumbUrl),
        remarkImageAssets: uploadedRemarkImages,
        competitors: await Promise.all(
          (Array.isArray(productWithWorkbook.workbookDetail.competitors) ? productWithWorkbook.workbookDetail.competitors : []).map(async (competitor, index) => {
            const hotVariantImageAsset = competitor.hotVariantImage.trim()
              ? await uploadDataUrlImage(competitor.hotVariantImage, `${product.sku || "product"}-competitor-${index + 1}.png`)
              : undefined;
            const noteImageAsset = competitor.noteImage.trim()
              ? await uploadDataUrlImage(competitor.noteImage, `${product.sku || "product"}-competitor-note-${index + 1}.png`)
              : undefined;

            return {
              ...competitor,
              hotVariantImageAsset,
              hotVariantImage: hotVariantImageAsset?.thumbUrl || "",
              noteImageAsset,
              noteImage: noteImageAsset?.thumbUrl || "",
            };
          }),
        ),
      }
    : undefined;

  return {
    ...product,
    images: [],
    imageAssets: uploadedImages,
    ...(workbookDetail ? { workbookDetail } : {}),
  };
}

async function uploadDataUrlImage(value: string, name: string) {
  if (!value.startsWith("data:")) {
    return {
      id: "",
      name,
      mimeType: "",
      size: 0,
      storageType: "r2",
      uploadedAt: "",
      thumbUrl: value,
      originalUrl: value,
    } satisfies ProductImageAsset;
  }

  const response = await fetch(value);
  const blob = await response.blob();
  const extension = blob.type === "image/jpeg" ? ".jpg" : blob.type === "image/webp" ? ".webp" : ".png";
  const file = new File([blob], name.replace(/\.[a-z0-9]+$/i, extension), {
    type: blob.type || "image/png",
  });

  return await uploadProductImageFile(file);
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
