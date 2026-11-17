import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { roleCanPerformAction, type RolePermissionMap } from "@/lib/accounts/permissions";
import { isProduct, normalizeProduct, productWriteErrorStatus, saveProductRequest } from "./product-write-service";
import type { CurrentUser } from "@/lib/auth/session";
import { clampPageSize, normalizeProductListSource, parseOptionalNumber } from "./product-list-query-builders";
import { getProductListService } from "./product-list-service";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { normalizeProductListSort } from "@/lib/products/list-sort";

export const runtime = "nodejs";

const maxProductPayloadBytes = 8 * 1024 * 1024;

export async function getProductsResponse(
  request: Request,
  context?: { user: CurrentUser; permissions: RolePermissionMap | Promise<RolePermissionMap> },
) {
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
    if (!(await assertWorkspaceAccess(user.organizationId, scope.workspaceId, user.id, undefined, request))) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    const source = normalizeProductListSource(url.searchParams.get("source"));
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const pageSize = clampPageSize(url.searchParams.get("pageSize"));
    const sort = normalizeProductListSort(url.searchParams.get("sortBy"), url.searchParams.get("sortDirection"));
    const search = url.searchParams.get("search")?.trim();
    const status = url.searchParams.get("status");
    const minPrice = parseOptionalNumber(url.searchParams.get("minPrice"));
    const maxPrice = parseOptionalNumber(url.searchParams.get("maxPrice"));
    const mySkuOwner = url.searchParams.get("mySkuOwner")?.trim();
    const createdByMe = url.searchParams.get("createdByMe") === "true";
    const includeSummary = url.searchParams.get("includeSummary") !== "false";
    const summaryOnly = url.searchParams.get("summaryOnly") === "true";
    return await getProductListService({
      user,
      workspaceId: scope.workspaceId,
      url,
      source,
      page,
      pageSize,
      sort,
      search,
      status,
      minPrice,
      maxPrice,
      mySkuOwner,
      createdByMe,
      includeSummary,
      summaryOnly,
      debugTiming,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load products.";
    console.info("[api/products]", { result: "error", message });
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
    const savedProduct = await saveProductRequest({ product, user, scope, canEditProducts, canCreateProducts });
    return NextResponse.json({ product: savedProduct });
  } catch (error) {
    const mappedError = productWriteErrorStatus(error);
    if (mappedError) return NextResponse.json(mappedError.body, { status: mappedError.status });
    const message = error instanceof Error ? error.message : "Failed to save product.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
