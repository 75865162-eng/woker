"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { stripAmazonProductObservations } from "@/lib/products/amazon-field-policy";
import type { Product, ProductListItem } from "@/lib/products/types";
import { toLightweightProduct } from "@/lib/products/lightweight-product";
import { defaultProductListSort, type ProductListSort } from "@/lib/products/list-sort";
import { useDraftState } from "@/lib/workspace/use-draft-state";
import { initialFilters, type ProductFilters } from "./product-workbench-model";
import { readCachedProductWorkbench, readCurrentWorkspaceId, normalizeProductFilters, emptyProductListSummary, writeCachedProductWorkbench, getProductListRequestCacheKey, getProductSummaryRequestCacheKey, productSummaryResponseCache, productSummaryInflight, REQUEST_CACHE_TTL_MS, scheduleNonCriticalTask, type ProductListSummary, type ProductWorkbenchInitialData } from "./product-workbench-cache";
import { mergeSavedProductIntoList, type PendingProduct } from "./product-list-state";

type ListResponse = {
  products?: Array<Product | ProductListItem>;
  pagination?: { total?: number };
  summary?: ProductListSummary;
  amazonAccounts?: Array<{ id: string; displayName: string }>;
  error?: string;
};

export function useProductList(initialData: ProductWorkbenchInitialData | undefined, currentUserName: string, setActivityLog: Dispatch<SetStateAction<string[]>>) {
  const cached = readCachedProductWorkbench();
  const hasInitial = Boolean(initialData && (typeof window === "undefined" || readCurrentWorkspaceId() === initialData.workspaceId));
  const [products, setProducts] = useState<Product[]>(() => ((hasInitial ? initialData!.products as unknown as Product[] : cached?.products) ?? []).map(stripAmazonProductObservations));
  const [filters, setFilters] = useDraftState<ProductFilters>("products:filters", normalizeProductFilters(hasInitial ? undefined : cached?.filters));
  const [page, setPage] = useDraftState("products:page", (hasInitial ? initialData?.pagination.page : cached?.page) ?? 1);
  const [pageSize, setPageSize] = useDraftState("products:page-size", (hasInitial ? initialData?.pagination.pageSize : cached?.pageSize) ?? 20);
  const [sort, setSort] = useDraftState<ProductListSort>("products:sort", defaultProductListSort);
  const [productsTotalCount, setProductsTotalCount] = useState((hasInitial ? initialData?.pagination.total : cached?.totalCount) ?? 0);
  const [listSummary, setListSummary] = useState<ProductListSummary>((hasInitial ? initialData?.summary : cached?.summary) ?? emptyProductListSummary);
  const [summaryReady, setSummaryReady] = useState(Boolean(hasInitial || cached));
  const [productsLoading, setProductsLoading] = useState(!hasInitial && !cached);
  const [productsError, setProductsError] = useState("");
  const [amazonAccounts, setAmazonAccounts] = useState<Array<{ id: string; displayName: string }>>([]);
  const [amazonAccountId, setAmazonAccountId] = useState("");
  const [mySkuCount, setMySkuCount] = useState(0);
  const [mySkuReady, setMySkuReady] = useState(false);
  const requestSeq = useRef(0);
  const summarySeq = useRef(0);
  const manualRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { manualRequest.current?.abort(); requestSeq.current++; summarySeq.current++; }, []);
  const pendingProduct = useRef<PendingProduct | null>(null);
  const previousFilters = useRef<ProductFilters | null>(null);
  const latest = useRef({ products, filters, page, pageSize, productsTotalCount, listSummary });
  useEffect(() => { latest.current = { products, filters, page, pageSize, productsTotalCount, listSummary }; }, [products, filters, page, pageSize, productsTotalCount, listSummary]);

  const fetchProducts = useCallback(async (input: { filters: ProductFilters; page: number; pageSize: number; sort?: ProductListSort; includeSummary?: boolean; detail?: boolean; signal?: AbortSignal }) => {
    const key = getProductListRequestCacheKey({ ...input, sort: input.sort ?? defaultProductListSort, sellerAccountId: amazonAccountId });
    const params = key.split("::").slice(1).join("::");
    const response = await fetch(`/api/products?${params}`, { cache: "no-store", signal: input.signal });
    const data = await response.json() as ListResponse;
    if (!response.ok) throw new Error(data.error || "商品数据读取失败");
    return data;
  }, [amazonAccountId]);

  const loadProductSummary = useCallback(async (signal: AbortSignal) => {
    const id = ++summarySeq.current;
    const cacheKey = getProductSummaryRequestCacheKey();
    try {
      const cachedSummary = productSummaryResponseCache.get(cacheKey);
      let data: { summary?: ProductListSummary; error?: string };
      if (cachedSummary && Date.now() - cachedSummary.cachedAt < REQUEST_CACHE_TTL_MS) {
        data = cachedSummary.data;
      } else {
        let promise = productSummaryInflight.get(cacheKey);
        if (!promise) {
          promise = (async () => {
            const response = await fetch("/api/products?summaryOnly=true&includeSummary=true", { cache: "no-store" });
            const result = await response.json() as { summary?: ProductListSummary; error?: string };
            if (!response.ok || !result.summary) throw new Error(result.error || "商品统计读取失败");
            return result;
          })();
          productSummaryInflight.set(cacheKey, promise);
          const shared = promise;
          void promise.finally(() => { if (productSummaryInflight.get(cacheKey) === shared) productSummaryInflight.delete(cacheKey); }).catch(() => {});
        }
        data = await promise;
      }
      if (signal.aborted || id !== summarySeq.current || cacheKey !== getProductSummaryRequestCacheKey()) return;
      productSummaryResponseCache.set(cacheKey, { cachedAt: Date.now(), data });
      if (data.summary) {
        setListSummary(data.summary);
        setSummaryReady(true);
        const current = latest.current;
        writeCachedProductWorkbench({ products: current.products, filters: current.filters, page: current.page, pageSize: current.pageSize, totalCount: current.productsTotalCount, summary: data.summary });
      }
    } catch (error) {
      if (signal.aborted || id !== summarySeq.current || cacheKey !== getProductSummaryRequestCacheKey()) return;
      setSummaryReady(true);
      setActivityLog(current => [`商品统计读取失败：${error instanceof Error ? error.message : "商品统计读取失败"}`, ...current].slice(0, 8));
    }
  }, [setActivityLog]);

  const loadProducts = useCallback(async (input: { filters: ProductFilters; page: number; pageSize: number; sort: ProductListSort }, signal: AbortSignal, id: number) => {
    const workspaceId = readCurrentWorkspaceId();
    setProductsLoading(true);
    setProductsError("");
    try {
      const data = await fetchProducts({ ...input, includeSummary: true, detail: true, signal });
      if (signal.aborted || id !== requestSeq.current || workspaceId !== readCurrentWorkspaceId()) return;
      const merged = mergeSavedProductIntoList((data.products ?? []) as Product[], data.pagination?.total ?? 0, pendingProduct.current, input);
      pendingProduct.current = merged.pending;
      setProducts(merged.products);
      setProductsTotalCount(merged.totalCount);
      setAmazonAccounts(data.amazonAccounts ?? []);
      if (data.summary) { setListSummary(data.summary); setSummaryReady(true); }
      writeCachedProductWorkbench({ products: merged.products, filters: input.filters, page: input.page, pageSize: input.pageSize, totalCount: merged.totalCount, summary: data.summary ?? latest.current.listSummary });
      setActivityLog(current => ["已从数据库读取商品列表", ...current].slice(0, 8));
      if (!data.summary) void loadProductSummary(signal);
    } catch (error) {
      if (signal.aborted || id !== requestSeq.current || workspaceId !== readCurrentWorkspaceId()) return;
      const message = error instanceof Error ? error.message : "商品数据读取失败";
      setProductsError(message);
      setActivityLog(current => [`商品数据读取失败：${message}`, ...current].slice(0, 8));
    } finally {
      if (!signal.aborted && id === requestSeq.current && workspaceId === readCurrentWorkspaceId()) setProductsLoading(false);
    }
  }, [fetchProducts, loadProductSummary, setActivityLog]);

  useEffect(() => {
    const debounce = previousFilters.current !== null && JSON.stringify(previousFilters.current) !== JSON.stringify(filters);
    previousFilters.current = filters;
    manualRequest.current?.abort();
    const id = ++requestSeq.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadProducts({ filters, page, pageSize, sort }, controller.signal, id), debounce ? 180 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [filters, page, pageSize, sort, loadProducts]);

  useEffect(() => {
    if (!currentUserName) { setMySkuCount(0); setMySkuReady(false); return; }
    const controller = new AbortController();
    const workspaceId = readCurrentWorkspaceId();
    const cancel = scheduleNonCriticalTask(() => void (async () => {
      try {
        const data = await fetchProducts({ filters: { ...initialFilters, mySkuOwner: currentUserName }, page: 1, pageSize: 1, includeSummary: false, detail: false, signal: controller.signal });
        if (!controller.signal.aborted && workspaceId === readCurrentWorkspaceId()) setMySkuCount(data.pagination?.total ?? 0);
      } catch { /* 非关键统计失败不影响列表 */ }
      finally { if (!controller.signal.aborted && workspaceId === readCurrentWorkspaceId()) setMySkuReady(true); }
    })());
    return () => { cancel(); controller.abort(); };
  }, [currentUserName, fetchProducts]);

  const pageCount = Math.max(1, Math.ceil(productsTotalCount / pageSize));
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount, setPage]);
  function reloadProducts(input?: { filters?: ProductFilters; page?: number; pageSize?: number }) {
    manualRequest.current?.abort();
    const controller = new AbortController();
    manualRequest.current = controller;
    return loadProducts({ filters: input?.filters ?? filters, page: input?.page ?? page, pageSize: input?.pageSize ?? pageSize, sort }, controller.signal, ++requestSeq.current);
  }
  function handleProductSaved(product: Product, isNew: boolean) {
    const lightweight = toLightweightProduct(product);
    pendingProduct.current = { product: lightweight, isNew };
    setProducts(current => current.some(item => item.sku.trim() === product.sku.trim()) ? current.map(item => item.sku.trim() === product.sku.trim() ? lightweight : item) : [lightweight, ...current]);
    if (isNew) { setProductsTotalCount(current => current + 1); setPage(1); }
    void reloadProducts({ page: isNew ? 1 : page });
  }
  function applyFilters(next: ProductFilters) { setPage(1); setFilters(next); }
  function patchFilters(updater: (current: ProductFilters) => ProductFilters) { setPage(1); setFilters(updater); }
  return { products, setProducts, filters, page, setPage, pageSize, setPageSize, sort, setSort, productsTotalCount, listSummary, summaryReady, mySkuCount, mySkuReady, productsLoading, productsError, setProductsError, amazonAccounts, setAmazonAccountId, amazonAccountId, pageCount, applyFilters, patchFilters, reloadProducts, handleProductSaved };
}
