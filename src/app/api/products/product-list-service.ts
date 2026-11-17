import { amazonDataAccess } from "@/lib/amazon-sync/data-access";
import { AmazonReadError } from "@/lib/amazon-sync/read-account";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { stripAmazonProductObservations } from "@/lib/products/amazon-field-policy";
import { readAmazonProductsForSkus } from "@/lib/operations/amazon-products";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import type { ProductListSort } from "@/lib/products/list-sort";
import type { CurrentUser } from "@/lib/auth/session";
import { splitMultiValue } from "@/lib/products/list-query";
import {
  buildProductListWhereSql,
  createServerTimingHeader,
  roundDuration,
  type ProductListResponse,
} from "./product-list-query-builders";
import { queryProductListPage } from "./product-list-repository";
import {
  createProductListResponseCacheKey,
  createProductListScopeKey,
  getCachedProductListResponse,
  getCachedProductListSummary,
  setCachedProductListResponse,
  setCachedProductListSummary,
} from "@/lib/products/product-list-cache";
import { refreshProductListSummaryBundle } from "@/lib/products/product-list-summary";

type ListInput = {
  user: CurrentUser;
  workspaceId: string;
  url: URL;
  source: "all" | "dashboard";
  page: number;
  pageSize: number;
  sort: ProductListSort;
  search?: string;
  status: string | null;
  minPrice?: number;
  maxPrice?: number;
  mySkuOwner?: string;
  createdByMe: boolean;
  includeSummary: boolean;
  summaryOnly: boolean;
  debugTiming: boolean;
};

export async function getProductListService(input: ListInput) {
  const { user, workspaceId, url, source, page, pageSize, sort, search, status, minPrice, maxPrice, mySkuOwner, createdByMe, includeSummary, summaryOnly, debugTiming } = input;
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  const measure = async <T>(name: string, promise: Promise<T>) => {
    const sectionStartedAt = performance.now();
    try {
      return await promise;
    } finally {
      timings[name] = roundDuration(performance.now() - sectionStartedAt);
    }
  };
  const opsAssignees = splitMultiValue(url.searchParams.get("opsAssignees"));
  const selectionOwners = splitMultiValue(url.searchParams.get("selectionOwners"));
  const designerAssignees = splitMultiValue(url.searchParams.get("designerAssignees"));
  const hasListFilters = Boolean(search) || Boolean(url.searchParams.get("asin")?.trim()) || Boolean(url.searchParams.get("supplierName")?.trim()) || opsAssignees.length > 0 || selectionOwners.length > 0 || designerAssignees.length > 0 || Boolean(mySkuOwner) || createdByMe || Number.isFinite(minPrice) || Number.isFinite(maxPrice) || (status !== null && status !== "all");
  const scopeKey = createProductListScopeKey({ organizationId: user.organizationId, workspaceId, source });
  const cacheKey = createProductListResponseCacheKey({
    scopeKey, page, pageSize, search,
    asin: url.searchParams.get("asin")?.trim() || undefined,
    status: status === "all" ? "" : status,
    supplierName: url.searchParams.get("supplierName")?.trim() || undefined,
    opsAssignees, selectionOwners, designerAssignees, mySkuOwner,
    createdByMe, createdByUserId: createdByMe ? user.id : undefined,
    minPrice, maxPrice, sort, detail: false, includeSummary,
  });
  const createTimedResponse = async (payload: unknown, result: "cache-hit" | "ok" | "unavailable", init?: ResponseInit) => {
    if (payload && typeof payload === "object" && "products" in payload) {
      const list = payload as ProductListResponse;
      const products = list.products.map(stripAmazonProductObservations);
      let amazonAccounts: Array<{ id: string; displayName: string }> = [];
      try {
        const amazonAccess = await amazonDataAccess({ organizationId: user.organizationId, workspaceId }, user.id);
        amazonAccounts = await prisma.sellerAccount.findMany({ where: { organizationId: user.organizationId, workspaceId, id: { in: amazonAccess.sellerIds }, status: "active" }, select: { id: true, displayName: true }, orderBy: { id: "asc" } });
        const sellerAccountId = url.searchParams.get("sellerAccountId") || (amazonAccess.sellerIds.length === 1 ? amazonAccess.sellerIds[0] : "");
        if (!sellerAccountId) throw new AmazonReadError("ACCOUNT_SCOPE_REQUIRED", "请选择单个 Amazon 账号后查询。", 400);
        const snapshots = await measure("amazonSnapshots", readAmazonProductsForSkus(user.organizationId, workspaceId, products.map(row => row.sku), user.id, { sellerAccountId }));
        payload = { ...list, amazonAccounts, products: products.map(row => ({ ...row, amazonSnapshots: snapshots.filter(snapshot => snapshot.sellerSku === row.sku) })) };
      } catch (error) {
        const amazonSnapshotErrorCode = error instanceof AmazonReadError ? error.businessCode : error instanceof SyncInputError && error.status === 403 ? "ACCOUNT_ACCESS_DENIED" : "AMAZON_READ_UNAVAILABLE";
        const amazonSnapshotError = error instanceof SyncInputError ? error.message : "Amazon 快照暂不可读；公司商品资料正常。";
        payload = { ...list, amazonAccounts, products: products.map(row => ({ ...row, amazonSnapshotError, amazonSnapshotErrorCode })) };
      }
    }
    const totalMs = roundDuration(performance.now() - startedAt);
    const response = NextResponse.json(payload, init);
    if (debugTiming || totalMs >= 500) console.info("[api/products]", { result, totalMs, timings, page, pageSize, source, detail: false, includeSummary, summaryOnly, hasListFilters });
    response.headers.set("Server-Timing", createServerTimingHeader(timings, totalMs));
    response.headers.set("X-Product-Cache", result === "cache-hit" ? "hit" : "miss");
    response.headers.set("X-Product-Data-Tier", "summary-row");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  const resolveSummary = async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cachedSummary = getCachedProductListSummary(scopeKey);
      if (cachedSummary) return cachedSummary;
    }
    const summaryBundle = await refreshProductListSummaryBundle({ organizationId: user.organizationId, workspaceId });
    for (const summarySource of ["all", "dashboard"] as const) {
      setCachedProductListSummary(createProductListScopeKey({ organizationId: user.organizationId, workspaceId, source: summarySource }), summaryBundle[summarySource]);
    }
    return summaryBundle[source];
  };

  if (!summaryOnly) {
    const cached = await getCachedProductListResponse<ProductListResponse>(cacheKey);
    if (cached) return createTimedResponse(cached, "cache-hit");
  }
  if (summaryOnly) return createTimedResponse({ summary: await measure("summary", resolveSummary(true)) }, "ok");

  try {
    const whereSql = buildProductListWhereSql({
      organizationId: user.organizationId, workspaceId, source, search,
      asin: url.searchParams.get("asin")?.trim(), status: status === "all" ? "" : status,
      supplierName: url.searchParams.get("supplierName")?.trim(), opsAssignees,
      selectionOwners, designerAssignees, mySkuOwner,
      createdByUserId: createdByMe ? user.id : undefined, minPrice, maxPrice,
    });
    const summaryPromise = includeSummary ? measure("summary", resolveSummary()) : Promise.resolve(null);
    const [listResult, summaryResult] = await Promise.all([
      measure("records", queryProductListPage({ whereSql, sort, page, pageSize, hasListFilters })),
      summaryPromise,
    ]);
    const summary = summaryResult ?? (hasListFilters ? undefined : await resolveSummary());
    const total = listResult.total ?? summary?.total ?? 0;
    const responsePayload: ProductListResponse = {
      products: listResult.products,
      pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    };
    if (summaryResult) responsePayload.summary = summaryResult;
    await setCachedProductListResponse(cacheKey, { organizationId: user.organizationId, workspaceId, scopeKey }, responsePayload);
    return createTimedResponse(responsePayload, "ok");
  } catch (error) {
    if (!isDatabaseUnavailableError(error)) throw error;
    return createTimedResponse({ products: [], pagination: { page, pageSize, total: 0, pageCount: 1 }, error: "数据库暂时不可用，商品列表已切换为空数据。" }, "unavailable", { status: 503 });
  }
}
