"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { newProductStatusOptions } from "@/data/products";
import type { Product, ProductDraft } from "@/lib/products/types";
import { stripAmazonProductObservations } from "@/lib/products/amazon-field-policy";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { parseProductWorkbookFile } from "./product-workbench-data";
import { uploadEmbeddedProductImages } from "./product-attachment-upload";
import { formatDateTime, nextSku } from "./product-workbench-utils";
import { productDetailCache, productDetailInflight, getProductDetailCacheKeyWithMode, readCurrentWorkspaceId, invalidateProductRequestCaches } from "./product-workbench-cache";

const newProductStatusValues = new Set(newProductStatusOptions.map((option) => option.value));

type ProductEditorOptions = {
  products: Product[];
  creatorName: string;
  identityKey: string;
  setActivityLog: Dispatch<SetStateAction<string[]>>;
  setProductsError: Dispatch<SetStateAction<string>>;
  onSaved: (product: Product, isNew: boolean) => void;
};

export function useProductEditor({ products, creatorName, identityKey, setActivityLog, setProductsError, onSaved }: ProductEditorOptions) {
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [importedEditorDraft, setImportedEditorDraft] = useState<Product | null>(null);
  const [detailReady, setDetailReady] = useState(true);
  const [detailError, setDetailError] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const requestSeq = useRef(0);
  const productsRef = useRef(products);

  useEffect(() => { productsRef.current = products; }, [products]);

  useEffect(() => {
    const reset = () => {
      requestSeq.current += 1;
      setIsEditorOpen(false);
      setActiveProduct(null);
      setImportedEditorDraft(null);
      setDetailError("");
      setDetailReady(true);
    };
    reset();
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => {
      requestSeq.current += 1;
      window.removeEventListener(workspaceScopeChangedEventName, reset);
    };
  }, [identityKey]);

  function openNewProduct() {
    requestSeq.current += 1;
    setImportedEditorDraft(null);
    setDetailError("");
    setActiveProduct(null);
    setDetailReady(true);
    setIsEditorOpen(true);
  }

  function closeProductEditor() {
    requestSeq.current += 1;
    setIsEditorOpen(false);
  }

  const loadProductDetail = useCallback(async (workspaceId: string, sku: string) => {
    const cacheKey = getProductDetailCacheKeyWithMode(workspaceId, sku, true);
    const cached = productDetailCache.get(cacheKey);
    if (cached) return cached;
    const inFlight = productDetailInflight.get(cacheKey);
    if (inFlight) return inFlight;
    const request = (async () => {
      const response = await fetch(`/api/products/${encodeURIComponent(sku)}/detail`, {
        cache: "no-store",
        headers: { "x-workspace-id": workspaceId },
      });
      const data = (await response.json()) as { product?: Product; error?: string };
      if (!response.ok || !data.product) throw new Error(data.error || "商品详情读取失败");
      productDetailCache.set(cacheKey, data.product);
      return data.product;
    })();
    productDetailInflight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (productDetailInflight.get(cacheKey) === request) productDetailInflight.delete(cacheKey);
    }
  }, []);

  const prefetchProduct = useCallback((sku: string) => {
    void loadProductDetail(readCurrentWorkspaceId(), sku.trim()).catch(() => undefined);
  }, [loadProductDetail]);

  const alignProductDetail = useCallback(async (workspaceId: string, sku: string) => {
    setDetailError("");
    const requestId = ++requestSeq.current;
    const isCurrent = () => requestId === requestSeq.current && workspaceId === readCurrentWorkspaceId();
    setDetailReady(false);
    try {
      const product = await loadProductDetail(workspaceId, sku);
      if (!isCurrent()) return;
      setActiveProduct(product);
      setDetailReady(true);
    } catch (error) {
      if (!isCurrent()) return;
      setDetailError(error instanceof Error ? error.message : "商品详情读取失败");
      setDetailReady(false);
    }
  }, [loadProductDetail]);

  const openProduct = useCallback(async (sku: string) => {
    setImportedEditorDraft(null);
    const normalizedSku = sku.trim();
    const workspaceId = readCurrentWorkspaceId();
    const cachedDetail = productDetailCache.get(getProductDetailCacheKeyWithMode(workspaceId, normalizedSku, true));
    const cachedTextDetail = productDetailCache.get(getProductDetailCacheKeyWithMode(workspaceId, normalizedSku, false));
    const listProduct = productsRef.current.find((product) => product.sku.trim() === normalizedSku) ?? null;
    setProductsError("");
    setActiveProduct(cachedDetail ?? cachedTextDetail ?? listProduct);
    setDetailError("");
    setDetailReady(false);
    setIsEditorOpen(true);
    await alignProductDetail(workspaceId, normalizedSku);
  }, [alignProductDetail, setProductsError]);

  async function handleSaveProduct(draft: ProductDraft, workspaceId = readCurrentWorkspaceId()) {
    const requestId = ++requestSeq.current;
    const existing = activeProduct;
    const isCurrent = () => requestId === requestSeq.current && workspaceId === readCurrentWorkspaceId();
    const product: Product = {
      ...draft,
      images: [],
      status: existing || newProductStatusValues.has(draft.status) ? draft.status : "pending",
      id: existing?.id ?? `prod-${draft.sku}`,
      sku: existing?.sku ?? draft.sku,
      createdAt: existing?.createdAt ?? formatDateTime(new Date()),
    };
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, workspaceId }),
      });
      const data = (await response.json()) as { product?: Product; error?: string; conflict?: boolean };
      if (!response.ok || !data.product) {
        const error = new Error(data.error || "商品保存失败");
        if (data.conflict) error.name = "ProductRevisionConflictError";
        throw error;
      }
      invalidateProductRequestCaches();
      productDetailCache.set(getProductDetailCacheKeyWithMode(workspaceId, data.product.sku, true), data.product);
      if (!isCurrent()) return;
      onSaved(data.product, !existing);
      setActivityLog((current) => [`${existing ? "保存" : "新增"}商品 ${data.product!.sku} 到数据库`, ...current].slice(0, 8));
    } catch (error) {
      if (isCurrent()) {
        const message = error instanceof Error ? error.message : "商品保存失败";
        setActivityLog((current) => [`商品保存失败：${message}`, ...current].slice(0, 8));
      }
      throw error;
    }
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    const requestId = ++requestSeq.current;
    const workspaceId = readCurrentWorkspaceId();
    const isCurrent = () => requestId === requestSeq.current && workspaceId === readCurrentWorkspaceId();
    try {
      const imported = await parseProductWorkbookFile(file, products, nextSku(products));
      if (!isCurrent()) return;
      const importedWithAssets = await uploadEmbeddedProductImages({ ...imported, selectionOwner: creatorName, developer: "" });
      if (!isCurrent()) return;
      setImportedEditorDraft(importedWithAssets);
      setActiveProduct(null);
      setDetailError("");
      setDetailReady(true);
      setIsEditorOpen(true);
      setActivityLog((current) => [`已导入 ${file.name} 到编辑草稿，请检查后点击保存才正式创建商品`, ...current].slice(0, 8));
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : "导入失败";
      setProductsError(message);
      setActivityLog((current) => [`导入失败：${message}`, ...current].slice(0, 8));
    }
  }

  function clearAmazonObservations() {
    setActiveProduct((product) => product ? stripAmazonProductObservations(product) : null);
  }

  return { activeProduct, importedEditorDraft, detailReady, detailError, isEditorOpen, openNewProduct, closeProductEditor, openProduct, prefetchProduct, alignProductDetail, handleSaveProduct, handleImportFile, clearAmazonObservations };
}
