import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import type { Product } from "@/lib/products/types";
import type { TrialProductDraft } from "@/components/products/product-workbench-model";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function normalizeSku(sku: string) {
  return sku.trim().toUpperCase();
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
    const record = await measure("detail", prisma.productRecord.findUnique({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku: normalizeSku(sku),
        },
      },
      select: {
        payload: true,
      },
    }));

    if (!record) {
      return createTimedResponse({ error: "商品不存在。" }, "not-found", { status: 404 });
    }

    const product = record.payload as unknown as Product;
    return createTimedResponse({ product: includeWorkbookImages ? product : stripWorkbookImages(product) }, "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load product.";
    const response = NextResponse.json({ error: message }, { status: 500 });
    response.headers.set("Server-Timing", `total;dur=${roundDuration(performance.now() - startedAt)}`);
    return response;
  }
}
