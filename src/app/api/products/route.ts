import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { prisma } from "@/lib/db/prisma";
import type { Product, ProductListItem } from "@/lib/products/types";
import {
  createProductListItem,
  createProductListWhere,
  getProductRecordCurrentOwner,
  getProductRecordIsOverdue,
  getProductRecordSource,
  isProductOperationsProgressIncomplete,
  splitMultiValue,
  type ProductListSource,
} from "@/lib/products/list-query";
import {
  createProductListResponseCacheKey,
  createProductListScopeKey,
  getCachedProductListResponse,
  getCachedProductListSummary,
  invalidateProductListResponseCaches,
  setCachedProductListResponse,
  setCachedProductListSummary,
  updateCachedProductListSummariesForProductChange,
} from "@/lib/products/product-list-cache";
import { applyProductListSummaryChange, refreshProductListSummaryBundle } from "@/lib/products/product-list-summary";
import { createWorkflowDueAt, getProductWorkflowStage, normalizeAssigneeList, productWorkflowStageLabels } from "@/lib/products/workflow";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

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
  minPrice?: number;
  maxPrice?: number;
}) {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"organizationId" = ${input.organizationId}`,
    Prisma.sql`"workspaceId" = ${input.workspaceId}`,
  ];

  if (input.source === "dashboard" || input.source === "sellfox") {
    conditions.push(Prisma.sql`"source" = ${input.source}`);
  }

  if (input.search) {
    const search = `%${input.search}%`;
    conditions.push(Prisma.sql`
      (
        "sku" ILIKE ${search}
        OR "id" ILIKE ${search}
        OR "chineseName" ILIKE ${search}
        OR "englishName" ILIKE ${search}
      )
    `);
  }

  if (input.asin) {
    conditions.push(Prisma.sql`"asin" ILIKE ${`%${input.asin}%`}`);
  }

  if (input.supplierName) {
    conditions.push(Prisma.sql`"supplierName" ILIKE ${`%${input.supplierName}%`}`);
  }

  if (input.opsAssignees.length) {
    conditions.push(Prisma.sql`"opsAssignee" IN (${Prisma.join(input.opsAssignees)})`);
  }

  if (input.selectionOwners.length) {
    conditions.push(Prisma.sql`"selectionOwner" IN (${Prisma.join(input.selectionOwners)})`);
  }

  if (input.designerAssignees.length) {
    conditions.push(Prisma.sql`"designerAssignee" IN (${Prisma.join(input.designerAssignees)})`);
  }

  if (input.mySkuOwner) {
    const ownerSearch = `%${input.mySkuOwner}%`;
    conditions.push(Prisma.sql`
      (
        "selectionOwner" ILIKE ${ownerSearch}
        OR "currentOwner" ILIKE ${ownerSearch}
        OR "opsAssignee" ILIKE ${ownerSearch}
        OR "designerAssignee" ILIKE ${ownerSearch}
      )
    `);
  }

  if (Number.isFinite(input.minPrice) || Number.isFinite(input.maxPrice)) {
    conditions.push(
      Prisma.sql`"purchasePrice" >= ${Number.isFinite(input.minPrice) ? input.minPrice : 0}`,
      Prisma.sql`"purchasePrice" <= ${Number.isFinite(input.maxPrice) ? input.maxPrice : Number.MAX_SAFE_INTEGER}`,
    );
  }

  if (input.status === "operations_progress") {
    conditions.push(Prisma.sql`"operationsProgressIncomplete" = true`);
  } else if (input.status === "overdue") {
    conditions.push(Prisma.sql`"status" NOT IN ('listed', 'canceled', 'delisted', 'patent_risk')`);
    conditions.push(Prisma.sql`"isOverdue" = true`);
  } else if (input.status && input.status !== "all") {
    conditions.push(Prisma.sql`"status" = ${input.status}`);
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

function toOptionalString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
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
    image: toOptionalString(record.image),
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
  return value === "sellfox" || value === "all" ? value : "dashboard";
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

function createProductRecordData(product: Product, user: { id: string; organizationId: string }, scope: { workspaceId: string; accountId: string; marketplace: string }) {
  const workflowStage = getProductWorkflowStage(product);

  return {
    userId: user.id,
    accountId: scope.accountId,
    marketplace: scope.marketplace,
    payload: product as unknown as Prisma.InputJsonValue,
    chineseName: product.chineseName,
    englishName: product.englishName,
    asin: product.asin,
    status: product.status,
    source: getProductRecordSource(product),
    supplierName: product.supplierName,
    purchasePrice: product.purchasePrice,
    selectionOwner: product.selectionOwner || product.developer || "",
    opsAssignee: product.opsAssignee || normalizeAssigneeList(undefined, product.opsAssignees).join("、"),
    designerAssignee: product.designerAssignee || normalizeAssigneeList(undefined, product.designerAssignees).join("、"),
    currentOwner: getProductRecordCurrentOwner(product),
    workflowStage,
    workflowDueAt: product.workflowDueAt ? new Date(product.workflowDueAt) : null,
    isOverdue: getProductRecordIsOverdue(product),
    operationsProgressIncomplete: isProductOperationsProgressIncomplete(product),
  };
}

function getWorkflowNotificationAssignees(product: Product) {
  const stage = getProductWorkflowStage(product);

  if (stage === "ops_confirming") {
    return normalizeAssigneeList(product.opsAssignee, product.opsAssignees);
  }

  if (stage === "design_in_progress" || stage === "design_review") {
    return normalizeAssigneeList(product.designerAssignee, product.designerAssignees);
  }

  return [];
}

function getPreviousWorkflowStage(product?: Partial<Product>) {
  if (!product) return undefined;

  return getProductWorkflowStage({
    status: product.status ?? "pending",
    developer: product.developer ?? "",
    selectionOwner: product.selectionOwner,
    opsAssignee: product.opsAssignee,
    opsAssignees: product.opsAssignees,
    designerAssignee: product.designerAssignee,
    designerAssignees: product.designerAssignees,
    workflowStage: product.workflowStage,
    workflowDueAt: product.workflowDueAt,
    workflowHistory: product.workflowHistory,
  });
}

async function createWorkflowNotifications(input: {
  user: { id: string; name: string; organizationId: string };
  product: Product;
  previousProduct?: Partial<Product>;
}) {
  const stage = getProductWorkflowStage(input.product);
  const previousStage = getPreviousWorkflowStage(input.previousProduct);

  if (stage === previousStage || (stage !== "ops_confirming" && stage !== "design_in_progress")) {
    return;
  }

  const assigneeNames = getWorkflowNotificationAssignees(input.product);

  if (!assigneeNames.length) {
    return;
  }

  const members = await prisma.teamRosterMember.findMany({
    where: {
      organizationId: input.user.organizationId,
      name: {
        in: assigneeNames,
      },
      status: {
        notIn: ["disabled", "archived"],
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!members.length) {
    return;
  }

  const memberships = await prisma.organizationMember.findMany({
    where: {
      organizationId: input.user.organizationId,
      userId: {
        in: members.map((member) => member.id),
      },
    },
    select: {
      userId: true,
    },
  });
  const recipientIds = new Set(memberships.map((membership) => membership.userId));
  const dueAt = input.product.workflowDueAt || createWorkflowDueAt(new Date());
  const title = stage === "ops_confirming" ? "新的运营处理任务" : "新的美工处理任务";
  const productName = input.product.chineseName || input.product.englishName || input.product.sku;
  const message = `${input.user.name} 已将 ${input.product.sku} ${productName} 流转到${productWorkflowStageLabels[stage]}，处理期限：${new Date(dueAt).toLocaleString("zh-CN", { hour12: false })}。`;
  const notifications: Prisma.UserNotificationCreateManyInput[] = members
    .filter((member) => recipientIds.has(member.id))
    .map((member) => ({
      organizationId: input.user.organizationId,
      recipientUserId: member.id,
      actorUserId: input.user.id,
      type: "product_workflow",
      title,
      message,
      entityType: "product",
      entityId: input.product.sku,
      metadata: {
        productId: input.product.id,
        sku: input.product.sku,
        stage,
        stageLabel: productWorkflowStageLabels[stage],
        dueAt,
        assigneeName: member.name,
      },
    }));

  if (!notifications.length) {
    return;
  }

  const userNotificationDelegate = prisma.userNotification as unknown as
    | {
        createMany?: (args: { data: Prisma.UserNotificationCreateManyInput[] }) => Promise<unknown>;
      }
    | undefined;

  if (typeof userNotificationDelegate?.createMany === "function") {
    await userNotificationDelegate.createMany({ data: notifications });
    return;
  }

  for (const notification of notifications) {
    await prisma.$executeRaw`
      INSERT INTO "UserNotification" (
        "organizationId",
        "recipientUserId",
        "actorUserId",
        "type",
        "title",
        "message",
        "entityType",
        "entityId",
        "metadata"
      ) VALUES (
        ${notification.organizationId},
        ${notification.recipientUserId},
        ${notification.actorUserId ?? null},
        ${notification.type},
        ${notification.title},
        ${notification.message},
        ${notification.entityType ?? null},
        ${notification.entityId ?? null},
        ${JSON.stringify(notification.metadata ?? null)}::jsonb
      )
    `;
  }
}

export async function GET(request: Request) {
  const startedAt = performance.now();
  const timings: Record<string, number> = {};

  try {
    const permission = await requireApiPermission("products", "view", request);

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
    const detail = url.searchParams.get("detail") === "full";
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
      minPrice,
      maxPrice,
      detail,
      includeSummary,
    });
    const createTimedResponse = (payload: unknown, result: "cache-hit" | "ok" | "unavailable", init?: ResponseInit) => {
      const totalMs = roundDuration(performance.now() - startedAt);
      if (!debugTiming && totalMs < 500) {
        const response = NextResponse.json(payload, init);
        response.headers.set("Server-Timing", createServerTimingHeader(timings, totalMs));
        response.headers.set("X-Product-Cache", result === "cache-hit" ? "hit" : "miss");
        return response;
      }

      console.info("[api/products]", {
        result,
        totalMs,
        timings,
        page,
        pageSize,
        source,
        detail,
        includeSummary,
        summaryOnly,
        hasListFilters,
      });
      const response = NextResponse.json(payload, init);
      response.headers.set("Server-Timing", createServerTimingHeader(timings, totalMs));
      response.headers.set("X-Product-Cache", result === "cache-hit" ? "hit" : "miss");
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

    if (!detail && !summaryOnly) {
      const cached = await getCachedProductListResponse<ProductListResponse>(cacheKey);
      if (cached) {
        return createTimedResponse(cached, "cache-hit");
      }
    }
    const where = createProductListWhere({
      user,
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
      minPrice,
      maxPrice,
    });
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
      for (const summarySource of ["all", "dashboard", "sellfox"] as const) {
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
        minPrice,
        maxPrice,
      });
      const listOffset = (page - 1) * pageSize;
      const recordsPromise = detail
        ? measure(
            "records",
            prisma.productRecord.findMany({
              where,
              orderBy: {
                updatedAt: "desc",
              },
              skip: listOffset,
              take: pageSize,
            }),
          )
        : measure(
            "records",
            prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
              SELECT
                "id",
                "sku",
                "chineseName",
                "englishName",
                "asin",
                "status",
                "selectionOwner",
                "opsAssignee",
                "designerAssignee",
                "currentOwner",
                "workflowStage",
                "createdAt",
                "updatedAt",
                "purchasePrice",
                "supplierName",
                "workflowDueAt",
                "isOverdue",
                COALESCE(NULLIF("payload"->>'specs', ''), '') AS "specs",
                COALESCE(NULLIF("payload"->>'keywords', ''), '') AS "keywords",
                COALESCE(NULLIF("payload"->>'note', ''), '') AS "note",
                COALESCE(NULLIF("payload"->'imageAssets'->0->>'thumbUrl', ''), '') AS "image"
              FROM "ProductRecord"
              ${listWhereSql}
              ORDER BY "updatedAt" DESC
              OFFSET ${listOffset}
              LIMIT ${pageSize}
            `),
          );
      const summaryPromise = includeSummary ? measure("summary", resolveSummary()) : Promise.resolve(null);

      if (hasListFilters) {
        const [countResult, recordsResult, summaryResult] = await Promise.all([
          measure("count", prisma.productRecord.count({ where })),
          recordsPromise,
          summaryPromise,
        ]);
        total = countResult;
        const products = detail
          ? (recordsResult as Awaited<ReturnType<typeof prisma.productRecord.findMany>>).map((record) => record.payload as unknown as Product)
          : (recordsResult as Array<Record<string, unknown>>).map((record) => mapProductListRow(record));

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

        if (!detail) {
          await setCachedProductListResponse(
            cacheKey,
            {
              organizationId: user.organizationId,
              workspaceId: scope.workspaceId,
              scopeKey,
            },
            responsePayload,
          );
        }

        return createTimedResponse(responsePayload, "ok");
      }

      const [recordsResult, summaryResult] = await Promise.all([recordsPromise, summaryPromise]);
      const summary = summaryResult ?? (await resolveSummary());
      total = summary.total;
      const products = detail
        ? (recordsResult as Awaited<ReturnType<typeof prisma.productRecord.findMany>>).map((record) => record.payload as unknown as Product)
        : (recordsResult as Array<Record<string, unknown>>).map((record) => mapProductListRow(record));

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

      if (!detail) {
        await setCachedProductListResponse(
          cacheKey,
          {
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            scopeKey,
          },
          responsePayload,
        );
      }

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

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("products", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as { product?: unknown; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };

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
      const existingProduct = existingRecord?.payload as Partial<Product> | undefined;
      const productToSave: Product = {
        ...product,
        videoPlan: product.videoPlan ?? existingProduct?.videoPlan,
      };

      if (requiresConclusionExcel(productToSave) && !productToSave.conclusionExcelFile?.id) {
        throw new Error("状态为已取消或已上架时，请先上传结论 Excel 表。");
      }

      await tx.productRecord.upsert({
        where: {
          organizationId_workspaceId_sku: {
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            sku: productToSave.sku,
          },
        },
        create: {
          id: productToSave.id,
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku: productToSave.sku,
          ...createProductRecordData(productToSave, user, scope),
        },
        update: createProductRecordData(productToSave, user, scope),
      });

      await applyProductListSummaryChange(tx, {
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
        before: existingProduct,
        after: productToSave,
      });

      return {
        existingProduct,
        productToSave,
      };
    });

    await createWorkflowNotifications({
      user,
      product: persisted.productToSave,
      previousProduct: persisted.existingProduct,
    });
    await recordDataChangeVersion({
      user,
      entityType: "product",
      entityId: persisted.productToSave.sku,
      action: "product_save",
      summary: `${persisted.productToSave.sku} ${persisted.productToSave.chineseName}`,
      payload: persisted.productToSave as unknown as Prisma.InputJsonValue,
      scope,
    });
    await invalidateProductListResponseCaches(`${user.organizationId}:${scope.workspaceId}:`);
    updateCachedProductListSummariesForProductChange({
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      before: persisted.existingProduct,
      after: persisted.productToSave,
    });

    return NextResponse.json({ product: persisted.productToSave });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save product.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
