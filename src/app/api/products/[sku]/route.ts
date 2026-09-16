import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import type { Product } from "@/lib/products/types";
import type { TrialProductDraft } from "@/components/products/product-workbench-model";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { getProductDetail } from "@/lib/products/product-detail-service";

export const runtime = "nodejs";

function normalizeSku(sku: string) {
  return sku.trim();
}

function stripWorkbookImages(product: Product) {
  const productWithWorkbook = product as Product & { workbookDetail?: TrialProductDraft };
  if (!productWithWorkbook.workbookDetail) {
    return product;
  }

  return {
    ...product,
    workbookDetail: {
      ...productWithWorkbook.workbookDetail,
      remarkImages: [],
      remarkImageAssets: [],
      competitors: productWithWorkbook.workbookDetail.competitors.map((row) => ({
        ...row,
        hotVariantImage: "",
        hotVariantImageAsset: undefined,
        noteImage: "",
        noteImageAsset: undefined,
      })),
    },
  } as Product;
}

function roundDuration(ms: number) {
  return Math.round(ms * 10) / 10;
}

export async function GET(request: Request, { params }: { params: Promise<{ sku: string }> }) {
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
    const includeWorkbookImages = url.searchParams.get("includeWorkbookImages") !== "false";
    const createTimedResponse = (payload: unknown, result: "ok" | "not-found", init?: ResponseInit) => {
      const totalMs = roundDuration(performance.now() - startedAt);
      if (debugTiming || totalMs >= 500) {
        console.info("[api/products/detail]", {
          result,
          totalMs,
          timings,
        });
      }

      const response = NextResponse.json(payload, init);
      response.headers.set("Server-Timing", [
        ...Object.entries(timings).map(([name, duration]) => `${name};dur=${duration}`),
        `total;dur=${totalMs}`,
      ].join(", "));
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

    const { sku } = await params;
    const scope = workspaceScopeFromRequest(request);
    const detail = await measure("detail", getProductDetail({
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      sku: normalizeSku(sku),
    }));

    if (!detail) {
      return createTimedResponse({ error: "商品不存在。" }, "not-found", { status: 404 });
    }

    const product = detail.product;
    const productWithRevision = {
      ...(includeWorkbookImages ? product : stripWorkbookImages(product)),
    } as Product;
    return createTimedResponse({
      product: productWithRevision,
      detail: {
        productCenter: detail.productCenter,
        summary: detail.summary,
        text: detail.text,
        workflow: detail.workflow,
        media: detail.media,
        metrics: detail.metrics,
        projection: detail.projection,
      },
    }, "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load product.";
    const response = NextResponse.json({ error: message }, { status: 500 });
    response.headers.set("Server-Timing", `total;dur=${roundDuration(performance.now() - startedAt)}`);
    return response;
  }
}
