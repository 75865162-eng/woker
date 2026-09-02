import { addProductListSummaries, getProductListSummarySourceContribution, subtractProductListSummaries } from "@/lib/products/product-list-summary";
import { prisma } from "@/lib/db/prisma";
import type { Product, ProductListSummary } from "@/lib/products/types";
import type { ProductListSource } from "@/lib/products/list-query";
import { Prisma } from "@prisma/client";

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

const listResponseCache = new Map<string, CachedValue<unknown>>();
const listSummaryCache = new Map<string, CachedValue<ProductListSummary>>();

const listResponseCacheTtlMs = 30_000;
const listSummaryCacheTtlMs = 60_000;

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
  minPrice?: number;
  maxPrice?: number;
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
    Number.isFinite(input.minPrice) ? input.minPrice : "",
    Number.isFinite(input.maxPrice) ? input.maxPrice : "",
    input.detail ? "full" : "list",
    input.includeSummary ? "with-summary" : "no-summary",
  ].join("|");
}

export async function getCachedProductListResponse<T>(cacheKey: string) {
  const cached = listResponseCache.get(cacheKey);
  if (!cached) {
    return getPersistedProductListResponse<T>(cacheKey);
  }

  if (cached.expiresAt < Date.now()) {
    listResponseCache.delete(cacheKey);
    return getPersistedProductListResponse<T>(cacheKey);
  }

  return cached.value as T;
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

    listResponseCache.set(cacheKey, {
      expiresAt,
      value: cached.payload,
    });
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
  listResponseCache.set(cacheKey, {
    expiresAt,
    value,
  });

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

export function getCachedProductListSummary(cacheKey: string) {
  const cached = listSummaryCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt < Date.now()) {
    listSummaryCache.delete(cacheKey);
    return null;
  }

  return cached.value;
}

export function setCachedProductListSummary(cacheKey: string, value: ProductListSummary) {
  listSummaryCache.set(cacheKey, {
    expiresAt: Date.now() + listSummaryCacheTtlMs,
    value,
  });
}

export function updateCachedProductListSummariesForProductChange(input: {
  organizationId: string;
  workspaceId: string;
  before?: Partial<Product> | null;
  after?: Partial<Product> | null;
}) {
  const now = new Date();

  for (const source of ["all", "dashboard", "sellfox"] as const) {
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
      subtractProductListSummaries(cached, getProductListSummarySourceContribution(input.before ?? null, source, now)),
      getProductListSummarySourceContribution(input.after ?? null, source, now),
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
