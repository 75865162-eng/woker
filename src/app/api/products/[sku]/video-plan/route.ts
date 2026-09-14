import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import type { Product } from "@/lib/products/types";
import {
  normalizeProductVideoPlan,
  type ProductVideoPlanDraft,
} from "@/lib/products/video-plan";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { enqueueProductOutboxEvent } from "@/lib/queue";
import {
  findProductRecordBySku,
  ProductRecordRevisionConflictError,
} from "@/lib/products/product-record-repository";
import { productRecordPayloadToProduct } from "@/lib/products/product-projection";
import { InvalidProductStatusError } from "@/lib/products/status-machine";
import { saveProductAggregate } from "@/lib/products/product-aggregate-service";

export const runtime = "nodejs";

function normalizeSku(sku: string) {
  return sku.trim();
}

export async function GET(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission("products", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const { sku } = await params;
    const scope = workspaceScopeFromRequest(request);
    const record = await findProductRecordBySku(
      prisma,
      { organizationId: user.organizationId, workspaceId: scope.workspaceId },
      normalizeSku(sku),
    );
    const product = record ? productRecordPayloadToProduct(record.payload) : null;

    return NextResponse.json({
      videoPlan: normalizeProductVideoPlan(product?.videoPlan as Partial<ProductVideoPlanDraft> | null),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load product video plan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const permission = await requireApiPermission("products", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const { sku } = await params;
    const normalizedSku = normalizeSku(sku);
    const body = (await request.json()) as { videoPlan?: Partial<ProductVideoPlanDraft>; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const record = await findProductRecordBySku(
      prisma,
      { organizationId: user.organizationId, workspaceId: scope.workspaceId },
      normalizedSku,
    );

    if (!record) {
      return NextResponse.json({ error: "商品不存在，无法保存视频策划。" }, { status: 404 });
    }

    const product = productRecordPayloadToProduct(record.payload) as Product;
    const videoPlan = normalizeProductVideoPlan(body.videoPlan);

    const nextProduct = {
      ...product,
      id: record.id,
      sku: record.sku,
      videoPlan,
    } as Product;

    const persisted = await prisma.$transaction(async (tx) => {
      const saved = await saveProductAggregate(tx, {
        product: nextProduct,
        user,
        scope: { ...scope, organizationId: user.organizationId },
        expectedRevision: record.revision,
        existingRecord: record,
      });

      return {
        saved,
        outboxEventId: saved.outboxEventId,
        projectionEventId: saved.projectionEventId,
      };
    });

    void Promise.all([
      enqueueProductOutboxEvent(persisted.outboxEventId),
      enqueueProductOutboxEvent(persisted.projectionEventId),
    ]).catch((error) => {
      console.warn("[api/products/video-plan] product outbox enqueue failed", {
        eventId: persisted.outboxEventId,
        sku: normalizedSku,
        message: error instanceof Error ? error.message : String(error),
      });
    });

    return NextResponse.json({
      videoPlan,
      revision: persisted.saved.product.revision,
    });
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
    const message = error instanceof Error ? error.message : "Failed to save product video plan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
