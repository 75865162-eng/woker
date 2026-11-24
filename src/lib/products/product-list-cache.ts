import { addProductListSummaries, createProductListSummaryContribution, subtractProductListSummaries } from "@/lib/products/product-list-summary";
import { prisma } from "@/lib/db/prisma";
import type { Product, ProductListSummary } from "@/lib/products/types";
import type { ProductListSource } from "@/lib/products/list-query";
import type { ProductListSort } from "@/lib/products/list-sort";
import { LruMap } from "@/lib/cache/lru-map";
import { Prisma } from "@prisma/client";

const listResponseCacheTtlMs = 30_000;
const listSummaryCacheTtlMs = 60_000;
/** 内存快照缓存上限：持久化表仍保留全量，内存层只留热点，避免无界增长。 */
const LIST_RESPONSE_CACHE_LIMIT = 500;
const LIST_SUMMARY_CACHE_LIMIT = 500;

const listResponseCache = new LruMap<unknown>({ maxEntries: LIST_RESPONSE_CACHE_LIMIT });
const listSummaryCache = new LruMap<ProductListSummary>({ maxEntries: LIST_SUMMARY_CACHE_LIMIT });

export function createProductListScopeKey(input: {
  organizationId: string;
  workspaceId: string;
  source: ProductListSource;
}) {
  return `${input.organizationId}:${input.workspaceId}:${input.source}`;
}

export function createProductListResponseCacheKey(input: {
  scopeKey: string;
  page: number;
  pageSize: number;
  search?: string;
  asin?: string;
  status?: string | null;
  supplierName?: string;
  opsAssignees: string[];
  selectionOwners: string[];
  designerAssignees: string[];
  mySkuOwner?: string;
  createdByMe?: boolean;
  createdByUserId?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: ProductListSort;
  detail: boolean;
  includeSummary: boolean;
}) {
  return [
    input.scopeKey,
    input.page,
    input.pageSize,
    input.search ?? "",
    input.asin ?? "",
    input.status ?? "",
    input.supplierName ?? "",
    input.opsAssignees.join(","),
    input.selectionOwners.join(","),
    input.designerAssignees.join(","),
    input.mySkuOwner ?? "",
    input.createdByMe ? "created-by-me" : "",
    input.createdByMe ? input.createdByUserId ?? "" : "",
    Number.isFinite(input.minPrice) ? input.minPrice : "",
    Number.isFinite(input.maxPrice) ? input.maxPrice : "",
    input.sort?.field ?? "createdAt",
    input.sort?.direction ?? "desc",
    input.detail ? "full" : "list",
    input.includeSummary ? "with-summary" : "no-summary",
  ].join("|");
}

export async function getCachedProductListResponse<T>(cacheKey: string) {
  const cached = listResponseCache.get(cacheKey);
  if (cached === undefined) {
    return getPersistedProductListResponse<T>(cacheKey);
  }
  return cached as T;
}

async function getPersistedProductListResponse<T>(cacheKey: string) {
  try {
    const cached = await prisma.productListCacheRecord.findUnique({
      where: {
        cacheKey,
      },
      select: {
        payload: true,
        expiresAt: true,
      },
    });

    if (!cached) {
      return null;
    }

    const expiresAt = cached.expiresAt.getTime();
    if (expiresAt < Date.now()) {
      await prisma.productListCacheRecord.deleteMany({
        where: {
          cacheKey,
        },
      });
      return null;
    }

    // 内存层 TTL 不超过持久化层的剩余有效期，避免内存比 DB 更“新”导致陈旧读。
    const remainingMs = expiresAt - Date.now();
    if (remainingMs > 0) listResponseCache.set(cacheKey, cached.payload, remainingMs);
    return cached.payload as T;
  } catch {
    return null;
  }
}

export async function setCachedProductListResponse<T>(
  cacheKey: string,
  scope: {
    organizationId: string;
    workspaceId: string;
    scopeKey: string;
  },
  value: T,
) {
  const expiresAt = Date.now() + listResponseCacheTtlMs;
  listResponseCache.set(cacheKey, value, listResponseCacheTtlMs);

  try {
    await prisma.productListCacheRecord.upsert({
      where: {
        cacheKey,
      },
      create: {
        cacheKey,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        scopeKey: scope.scopeKey,
        payload: value as Prisma.InputJsonValue,
        expiresAt: new Date(expiresAt),
      },
      update: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        scopeKey: scope.scopeKey,
        payload: value as Prisma.InputJsonValue,
        expiresAt: new Date(expiresAt),
      },
    });
  } catch {
    // In-memory cache remains a best-effort fallback if the shared cache table is unavailable.
  }
}

export function getCachedProductListSummary(cacheKey: string): ProductListSummary | null {
  return listSummaryCache.get(cacheKey) ?? null;
}

export function setCachedProductListSummary(cacheKey: string, value: ProductListSummary) {
  listSummaryCache.set(cacheKey, value, listSummaryCacheTtlMs);
}

export function updateCachedProductListSummariesForProductChange(input: {
  organizationId: string;
  workspaceId: string;
  before?: Partial<Product> | null;
  after?: Partial<Product> | null;
}) {
  const now = new Date();

  for (const source of ["all", "dashboard"] as const) {
    const cacheKey = createProductListScopeKey({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      source,
    });
    const cached = getCachedProductListSummary(cacheKey);

    if (!cached) {
      continue;
    }

    const next = addProductListSummaries(
      subtractProductListSummaries(cached, createProductListSummaryContribution(input.before ?? null, now)),
      createProductListSummaryContribution(input.after ?? null, now),
    );
    setCachedProductListSummary(cacheKey, next);
  }
}

export async function invalidateProductListResponseCaches(scopeKeyPrefix?: string) {
  if (!scopeKeyPrefix) {
    listResponseCache.clear();
    await deletePersistedProductListResponseCaches();
    return;
  }

  for (const key of listResponseCache.keys()) {
    if (key.startsWith(scopeKeyPrefix)) {
      listResponseCache.delete(key);
    }
  }
  await deletePersistedProductListResponseCaches(scopeKeyPrefix);
}

async function deletePersistedProductListResponseCaches(scopeKeyPrefix?: string) {
  try {
    await prisma.productListCacheRecord.deleteMany({
      where: scopeKeyPrefix
        ? {
          scopeKey: {
            startsWith: scopeKeyPrefix,
          },
        }
        : undefined,
    });
  } catch {
    // Best effort only; expired shared cache rows are ignored on read.
  }
}

export async function pruneExpiredProductListResponseCaches() {
  try {
    await prisma.productListCacheRecord.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  } catch {
    // Best effort only.
  }
}

export function invalidateProductListSummaryCaches(scopeKeyPrefix?: string) {
  if (!scopeKeyPrefix) {
    listSummaryCache.clear();
    return;
  }

  for (const key of listSummaryCache.keys()) {
    if (key.startsWith(scopeKeyPrefix)) {
      listSummaryCache.delete(key);
    }
  }
}

export async function invalidateProductListCaches(scopeKeyPrefix?: string) {
  await invalidateProductListResponseCaches(scopeKeyPrefix);
  invalidateProductListSummaryCaches(scopeKeyPrefix);
}
