import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { roleCanPerformAction, type RolePermissionMap } from "@/lib/accounts/permissions";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { prisma } from "@/lib/db/prisma";
import type { Product, ProductListItem } from "@/lib/products/types";
import type { CurrentUser } from "@/lib/auth/session";
import {
  createProductListItem,
  hasStandardProductStatus,
  splitMultiValue,
  type ProductListSource,
} from "@/lib/products/list-query";
import {
  createProductListResponseCacheKey,
  createProductListScopeKey,
  getCachedProductListResponse,
  getCachedProductListSummary,
  invalidateProductListSummaryCaches,
  invalidateProductListResponseCaches,
  setCachedProductListResponse,
  setCachedProductListSummary,
} from "@/lib/products/product-list-cache";
import { refreshProductListSummaryBundle } from "@/lib/products/product-list-summary";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { enqueueProductOutboxEvent } from "@/lib/queue";
import { ProductRecordRevisionConflictError } from "@/lib/products/product-record-repository";
import { InvalidProductStatusError } from "@/lib/products/status-machine";
import { saveProductAggregate } from "@/lib/products/product-aggregate-service";

export const runtime = "nodejs";

const maxProductPayloadBytes = 8 * 1024 * 1024;

type ProductListResponse = {
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

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object") return false;

  const product = value as Partial<Product>;
  return Boolean(product.id && product.sku && typeof product.chineseName === "string");
}

function normalizeProduct(product: Product): Product {
  return {
    ...product,
    id: product.id || `prod-${product.sku}`,
    sku: product.sku.trim(),
    competitorAsins: Array.isArray(product.competitorAsins) ? product.competitorAsins : [],
    images: Array.isArray(product.images) ? product.images : [],
  };
}

function requiresConclusionExcel(product: Product) {
  return product.status === "canceled" || product.status === "listed";
}

class ProductWritePermissionError extends Error {
  constructor(action: "create" | "edit") {
    super(action === "create" ? "当前账号没有新增商品的权限。" : "当前账号没有编辑该商品的权限。");
    this.name = "ProductWritePermissionError";
  }
}

function clampPageSize(value: string | null) {
  const pageSize = Number(value) || 50;
  return Math.min(Math.max(pageSize, 1), 200);
}

function parseOptionalNumber(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function buildProductListWhereSql(input: {
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

function mapProductListRow(record: Record<string, unknown>): ProductListItem {
  return createProductListItem({
    id: String(record.id ?? ""),
    sku: String(record.sku ?? ""),
    chineseName: String(record.chineseName ?? ""),
    englishName: String(record.englishName ?? ""),
    image: toOptionalImageUrl(record.image),
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

function normalizeProductListSource(value: string | null): ProductListSource {
  return value === "all" ? value : "dashboard";
}

function roundDuration(ms: number) {
  return Math.round(ms * 10) / 10;
}

function createServerTimingHeader(timings: Record<string, number>, totalMs: number) {
  return [
    ...Object.entries(timings).map(([name, duration]) => `${name};dur=${duration}`),
    `total;dur=${totalMs}`,
  ].join(", ");
}

export async function getProductsResponse(
  request: Request,
  context?: { user: CurrentUser; permissions: RolePermissionMap | Promise<RolePermissionMap> },
) {
  const startedAt = performance.now();
  const timings: Record<string, number> = {};

  try {
    const permissions = context ? await context.permissions : null;
    const permission = context
      ? roleCanPerformAction(context.user.role, "products", "view", permissions)
        ? { ok: true as const, user: context.user }
        : {
            ok: false as const,
            response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
          }
      : await requireApiPermission("products", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const url = new URL(request.url);
    const debugTiming = url.searchParams.get("debugTiming") === "true";
    const scope = workspaceScopeFromRequest(request);
    const source = normalizeProductListSource(url.searchParams.get("source"));
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const pageSize = clampPageSize(url.searchParams.get("pageSize"));
    const search = url.searchParams.get("search")?.trim();
    const status = url.searchParams.get("status");
    const minPrice = parseOptionalNumber(url.searchParams.get("minPrice"));
    const maxPrice = parseOptionalNumber(url.searchParams.get("maxPrice"));
    const mySkuOwner = url.searchParams.get("mySkuOwner")?.trim();
    const createdByMe = url.searchParams.get("createdByMe") === "true";
    const includeSummary = url.searchParams.get("includeSummary") !== "false";
    const summaryOnly = url.searchParams.get("summaryOnly") === "true";
    const opsAssignees = splitMultiValue(url.searchParams.get("opsAssignees"));
    const selectionOwners = splitMultiValue(url.searchParams.get("selectionOwners"));
    const designerAssignees = splitMultiValue(url.searchParams.get("designerAssignees"));
    const hasListFilters =
      Boolean(search) ||
      Boolean(url.searchParams.get("asin")?.trim()) ||
      Boolean(url.searchParams.get("supplierName")?.trim()) ||
      opsAssignees.length > 0 ||
      selectionOwners.length > 0 ||
      designerAssignees.length > 0 ||
      Boolean(mySkuOwner) ||
      createdByMe ||
      Number.isFinite(minPrice) ||
      Number.isFinite(maxPrice) ||
      (status !== null && status !== "all");
    const scopeKey = createProductListScopeKey({
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      source,
    });
    const cacheKey = createProductListResponseCacheKey({
      scopeKey,
      page,
      pageSize,
      search,
      asin: url.searchParams.get("asin")?.trim() || undefined,
      status: status === "all" ? "" : status,
      supplierName: url.searchParams.get("supplierName")?.trim() || undefined,
      opsAssignees,
      selectionOwners,
      designerAssignees,
      mySkuOwner,
      createdByMe,
      createdByUserId: createdByMe ? user.id : undefined,
      minPrice,
      maxPrice,
      detail: false,
      includeSummary,
    });
    const createTimedResponse = (payload: unknown, result: "cache-hit" | "ok" | "unavailable", init?: ResponseInit) => {
      const totalMs = roundDuration(performance.now() - startedAt);
      if (!debugTiming && totalMs < 500) {
        const response = NextResponse.json(payload, init);
        response.headers.set("Server-Timing", createServerTimingHeader(timings, totalMs));
        response.headers.set("X-Product-Cache", result === "cache-hit" ? "hit" : "miss");
        response.headers.set("X-Product-Data-Tier", "summary-row");
        response.headers.set("Cache-Control", "private, max-age=0, stale-while-revalidate=30");
        return response;
      }

      console.info("[api/products]", {
        result,
        totalMs,
        timings,
        page,
        pageSize,
        source,
        detail: false,
        includeSummary,
        summaryOnly,
        hasListFilters,
      });
      const response = NextResponse.json(payload, init);
      response.headers.set("Server-Timing", createServerTimingHeader(timings, totalMs));
      response.headers.set("X-Product-Cache", result === "cache-hit" ? "hit" : "miss");
      response.headers.set("X-Product-Data-Tier", "summary-row");
      response.headers.set("Cache-Control", "private, max-age=0, stale-while-revalidate=30");
      return response;
    };
    const measure = async <T>(name: string, promise: Promise<T>) => {
      const sectionStartedAt = performance.now();
      try {
        return await promise;
      } finally {
        timings[name] = roundDuration(performance.now() - sectionStartedAt);
      }
    };

    if (!summaryOnly) {
      const cached = await getCachedProductListResponse<ProductListResponse>(cacheKey);
      if (cached) {
        return createTimedResponse(cached, "cache-hit");
      }
    }
    let total = 0;
    const resolveSummary = async (forceRefresh = false) => {
      if (!forceRefresh) {
        const cachedSummary = getCachedProductListSummary(scopeKey);
        if (cachedSummary) {
          return cachedSummary;
        }
      }

      const summaryBundle = await refreshProductListSummaryBundle({
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
      });
      for (const summarySource of ["all", "dashboard"] as const) {
        setCachedProductListSummary(
          createProductListScopeKey({
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            source: summarySource,
          }),
          summaryBundle[summarySource],
        );
      }

      return summaryBundle[source];
    };

    if (summaryOnly) {
      const summary = await measure("summary", resolveSummary(true));
      return createTimedResponse({ summary }, "ok");
    }

    try {
      const listWhereSql = buildProductListWhereSql({
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
        source,
        search,
        asin: url.searchParams.get("asin")?.trim(),
        status: status === "all" ? "" : status,
        supplierName: url.searchParams.get("supplierName")?.trim(),
        opsAssignees,
        selectionOwners,
        designerAssignees,
        mySkuOwner,
        createdByUserId: createdByMe ? user.id : undefined,
        minPrice,
        maxPrice,
      });
      const listOffset = (page - 1) * pageSize;
      const recordsPromise = measure(
        "records",
        prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
          SELECT
            r."id" AS "id",
            COALESCE(s."sku", r."sku") AS "sku",
            COALESCE(s."chineseName", r."chineseName") AS "chineseName",
            COALESCE(s."englishName", r."englishName") AS "englishName",
            COALESCE(s."asin", r."asin") AS "asin",
            COALESCE(s."status", r."status") AS "status",
            COALESCE(s."selectionOwner", r."selectionOwner") AS "selectionOwner",
            COALESCE(s."opsAssignee", r."opsAssignee") AS "opsAssignee",
            COALESCE(s."designerAssignee", r."designerAssignee") AS "designerAssignee",
            COALESCE(s."currentOwner", r."currentOwner") AS "currentOwner",
            COALESCE(s."workflowStage", r."workflowStage") AS "workflowStage",
            COALESCE(s."createdAt", r."createdAt") AS "createdAt",
            COALESCE(s."updatedAt", r."updatedAt") AS "updatedAt",
            COALESCE(s."purchasePrice", r."purchasePrice") AS "purchasePrice",
            COALESCE(s."supplierName", r."supplierName") AS "supplierName",
            COALESCE(s."workflowDueAt", r."workflowDueAt") AS "workflowDueAt",
            CASE
              WHEN COALESCE(s."status", r."status") IN ('listed', 'canceled', 'delisted', 'patent_risk') THEN false
              WHEN COALESCE(s."workflowDueAt", r."workflowDueAt") IS NOT NULL
                THEN COALESCE(s."workflowDueAt", r."workflowDueAt") < NOW()
              ELSE COALESCE(s."createdAt", r."createdAt") < NOW() - INTERVAL '3 days'
            END AS "isOverdue",
            COALESCE(t."specs", r."payload"->>'specs', '') AS "specs",
            COALESCE(t."keywords", r."payload"->>'keywords', '') AS "keywords",
            COALESCE(t."note", r."payload"->>'note', '') AS "note",
            COALESCE(
              CASE
                WHEN LOWER(LEFT(COALESCE(s."primaryImageUrl", ''), 5)) <> 'data:'
                THEN NULLIF(s."primaryImageUrl", '')
                ELSE NULL
              END,
              CASE
                WHEN LOWER(LEFT(COALESCE(image_asset.asset->>'thumbUrl', ''), 5)) <> 'data:'
                THEN NULLIF(image_asset.asset->>'thumbUrl', '')
                ELSE NULL
              END,
              CASE
                WHEN NULLIF(image_asset.asset->>'thumbFileId', '') IS NOT NULL
                  AND LOWER(LEFT(image_asset.asset->>'thumbFileId', 14)) <> 'product-image-'
                THEN '/api/products/file-assets/' || (image_asset.asset->>'thumbFileId') || '/download'
                WHEN NULLIF(image_asset.asset->>'id', '') IS NOT NULL
                  AND LOWER(LEFT(image_asset.asset->>'id', 14)) <> 'product-image-'
                THEN '/api/products/file-assets/' || (image_asset.asset->>'id') || '/download'
                ELSE NULL
              END,
              CASE
                WHEN LOWER(LEFT(COALESCE(image_asset.asset->>'originalUrl', ''), 5)) <> 'data:'
                THEN NULLIF(image_asset.asset->>'originalUrl', '')
                ELSE NULL
              END,
              CASE
                WHEN LOWER(LEFT(COALESCE(r."payload"->>'image', ''), 5)) <> 'data:'
                THEN NULLIF(r."payload"->>'image', '')
                ELSE NULL
              END,
              CASE
                WHEN jsonb_typeof(r."payload"->'images') = 'array'
                  AND LOWER(LEFT(COALESCE(r."payload"#>>'{images,0}', ''), 5)) <> 'data:'
                THEN NULLIF(r."payload"#>>'{images,0}', '')
                ELSE NULL
              END,
              ''
            ) AS "image"
          FROM "ProductRecord" r
          LEFT JOIN "ProductSummaryRecord" s
            ON s."productRecordId" = r."id"
            AND s."organizationId" = r."organizationId"
            AND s."workspaceId" = r."workspaceId"
            AND s."sourceRevision" = r."revision"
          LEFT JOIN "ProductTextRecord" t
            ON t."productRecordId" = r."id"
            AND t."organizationId" = r."organizationId"
            AND t."workspaceId" = r."workspaceId"
            AND t."language" = 'default'
            AND t."sourceRevision" = r."revision"
          LEFT JOIN LATERAL (
            SELECT entries.asset
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(r."payload"->'imageAssets') = 'array'
                THEN r."payload"->'imageAssets'
                ELSE '[]'::jsonb
              END
            ) WITH ORDINALITY AS entries(asset, position)
            WHERE (
              (
                NULLIF(entries.asset->>'thumbUrl', '') IS NOT NULL
                AND LOWER(LEFT(entries.asset->>'thumbUrl', 5)) <> 'data:'
              )
              OR (
                NULLIF(entries.asset->>'thumbFileId', '') IS NOT NULL
                AND LOWER(LEFT(entries.asset->>'thumbFileId', 14)) <> 'product-image-'
              )
              OR (
                NULLIF(entries.asset->>'id', '') IS NOT NULL
                AND LOWER(LEFT(entries.asset->>'id', 14)) <> 'product-image-'
              )
              OR (
                NULLIF(entries.asset->>'originalUrl', '') IS NOT NULL
                AND LOWER(LEFT(entries.asset->>'originalUrl', 5)) <> 'data:'
              )
            )
            ORDER BY entries.position
            LIMIT 1
          ) image_asset ON true
          ${listWhereSql}
          ORDER BY COALESCE(s."createdAt", r."createdAt") DESC, COALESCE(s."sku", r."sku") ASC
          OFFSET ${listOffset}
          LIMIT ${pageSize}
        `),
      );
      const summaryPromise = includeSummary ? measure("summary", resolveSummary()) : Promise.resolve(null);

      if (hasListFilters) {
        const [countResult, recordsResult, summaryResult] = await Promise.all([
          measure(
            "count",
            prisma.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
              SELECT COUNT(*)::int AS "count"
              FROM "ProductRecord" r
              LEFT JOIN "ProductSummaryRecord" s
                ON s."productRecordId" = r."id"
                AND s."organizationId" = r."organizationId"
                AND s."workspaceId" = r."workspaceId"
                AND s."sourceRevision" = r."revision"
              LEFT JOIN "ProductTextRecord" t
                ON t."productRecordId" = r."id"
                AND t."organizationId" = r."organizationId"
                AND t."workspaceId" = r."workspaceId"
                AND t."language" = 'default'
                AND t."sourceRevision" = r."revision"
              ${listWhereSql}
            `),
          ).then((rows) => Number(rows[0]?.count ?? 0)),
          recordsPromise,
          summaryPromise,
        ]);
        total = countResult;
        const products = (recordsResult as Array<Record<string, unknown>>).map((record) => mapProductListRow(record));

        const responsePayload: ProductListResponse = {
          products,
          pagination: {
            page,
            pageSize,
            total,
            pageCount: Math.max(1, Math.ceil(total / pageSize)),
          },
        };

        if (summaryResult) {
          responsePayload.summary = summaryResult;
        }

        await setCachedProductListResponse(
          cacheKey,
          {
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            scopeKey,
          },
          responsePayload,
        );

        return createTimedResponse(responsePayload, "ok");
      }

      const [recordsResult, summaryResult] = await Promise.all([recordsPromise, summaryPromise]);
      const summary = summaryResult ?? (await resolveSummary());
      total = summary.total;
      const products = (recordsResult as Array<Record<string, unknown>>).map((record) => mapProductListRow(record));

      const responsePayload: ProductListResponse = {
        products,
        pagination: {
          page,
          pageSize,
          total,
          pageCount: Math.max(1, Math.ceil(total / pageSize)),
        },
      };

      if (summaryResult) {
        responsePayload.summary = summaryResult;
      }

      await setCachedProductListResponse(
        cacheKey,
        {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          scopeKey,
        },
        responsePayload,
      );

      return createTimedResponse(responsePayload, "ok");
    } catch (error) {
      if (!isDatabaseUnavailableError(error)) {
        throw error;
      }

      return createTimedResponse(
        {
          products: [],
          pagination: {
            page,
            pageSize,
            total: 0,
            pageCount: 1,
          },
          error: "数据库暂时不可用，商品列表已切换为空数据。",
        },
        "unavailable",
        { status: 503 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load products.";
    console.info("[api/products]", {
      result: "error",
      totalMs: roundDuration(performance.now() - startedAt),
      timings,
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return getProductsResponse(request);
}

export async function POST(request: Request) {
  try {
    const editPermission = await requireApiPermission("products", "edit", request);
    const createPermission = await requireApiPermission("products", "create", request);

    if (!editPermission.ok && !createPermission.ok) {
      return createPermission.response;
    }
    const user = editPermission.ok
      ? editPermission.user
      : createPermission.ok
        ? createPermission.user
        : undefined;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const canEditProducts = editPermission.ok;
    const canCreateProducts = createPermission.ok;

    let body: { product?: unknown; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };
    try {
      const contentLength = Number(request.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxProductPayloadBytes) {
        return NextResponse.json(
          { error: "商品数据过大，请移除内嵌图片后重新保存。" },
          { status: 413 },
        );
      }

      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody, "utf8") > maxProductPayloadBytes) {
        return NextResponse.json(
          { error: "商品数据过大，请移除内嵌图片后重新保存。" },
          { status: 413 },
        );
      }
      body = JSON.parse(rawBody) as { product?: unknown; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };
    } catch {
      return NextResponse.json(
        { error: "商品数据过大或上传内容不完整，请检查附件是否超过 10MB 后重新上传。" },
        { status: 413 },
      );
    }

    if (!isProduct(body.product)) {
      return NextResponse.json({ error: "Invalid product payload." }, { status: 400 });
    }

    const product = normalizeProduct(body.product);
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const persisted = await prisma.$transaction(async (tx) => {
      const existingRecord = await tx.productRecord.findUnique({
        where: {
          organizationId_workspaceId_sku: {
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            sku: product.sku,
          },
        },
      });
      if (existingRecord && !canEditProducts) {
        throw new ProductWritePermissionError("edit");
      }
      if (!existingRecord && !canCreateProducts) {
        throw new ProductWritePermissionError("create");
      }
      const existingProduct = existingRecord?.payload as Partial<Product> | undefined;
      const requestedRevision = typeof product.revision === "number" && Number.isInteger(product.revision)
        ? product.revision
        : undefined;
      const productToSave: Product = {
        ...product,
        id: existingRecord?.id ?? product.id,
        videoPlan: product.videoPlan ?? existingProduct?.videoPlan,
      };

      if (requiresConclusionExcel(productToSave) && !productToSave.conclusionExcelFile?.id) {
        throw new Error("状态为已取消或已上架时，请先上传结论 Excel 表。");
      }

      const saved = await saveProductAggregate(tx, {
        product: productToSave,
        user,
        scope: { ...scope, organizationId: user.organizationId },
        expectedRevision: requestedRevision,
        existingRecord,
      });
      return {
        productToSave: saved.product,
        outboxEventId: saved.outboxEventId,
        projectionEventId: saved.projectionEventId,
      };
    });

    void Promise.all([
      enqueueProductOutboxEvent(persisted.outboxEventId),
      enqueueProductOutboxEvent(persisted.projectionEventId),
    ]).catch((error) => {
      console.warn("[api/products] product outbox enqueue failed", {
        eventId: persisted.outboxEventId,
        sku: persisted.productToSave.sku,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    await invalidateProductListResponseCaches(`${user.organizationId}:${scope.workspaceId}:`).catch((error) => {
      console.warn("[api/products] product cache invalidation failed", {
        sku: persisted.productToSave.sku,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    invalidateProductListSummaryCaches(`${user.organizationId}:${scope.workspaceId}:`);

    return NextResponse.json({ product: persisted.productToSave });
  } catch (error) {
    if (error instanceof ProductRecordRevisionConflictError) {
      return NextResponse.json(
        { error: error.message, conflict: true, currentRevision: error.currentRevision },
        { status: 409 },
      );
    }
    if (error instanceof InvalidProductStatusError) {
      return NextResponse.json({ error: error.message, code: "INVALID_PRODUCT_STATUS_TRANSITION" }, { status: 400 });
    }
    if (error instanceof ProductWritePermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Failed to save product.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
