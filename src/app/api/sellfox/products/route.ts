import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { createProductListWhere } from "@/lib/products/list-query";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { sellfoxProductRecordToProduct } from "@/lib/sellfox/product-records";

export const runtime = "nodejs";

function clampPageSize(value: string | null) {
  const pageSize = Number(value) || 50;
  return Math.min(Math.max(pageSize, 1), 200);
}

function parseSourceWhere(url: URL, organizationId: string, workspaceId: string) {
  return createProductListWhere({
    user: { organizationId },
    workspaceId,
    source: "sellfox",
    search: url.searchParams.get("search")?.trim(),
    asin: url.searchParams.get("asin")?.trim(),
    status: url.searchParams.get("status") === "all" ? "" : url.searchParams.get("status"),
    supplierName: url.searchParams.get("supplierName")?.trim(),
    opsAssignees: (url.searchParams.get("opsAssignees") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    selectionOwners: (url.searchParams.get("selectionOwners") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    designerAssignees: (url.searchParams.get("designerAssignees") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    minPrice: Number(url.searchParams.get("minPrice")),
    maxPrice: Number(url.searchParams.get("maxPrice")),
  }) as Prisma.SellfoxProductRecordWhereInput;
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("products", "view", request);
    if (!permission.ok) return permission.response;

    const { user } = permission;
    const url = new URL(request.url);
    const scope = workspaceScopeFromRequest(request);
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const pageSize = clampPageSize(url.searchParams.get("pageSize"));
    const where = parseSourceWhere(url, user.organizationId, scope.workspaceId);

    const [sellfoxTotal, legacyTotal, sellfoxRecords, legacyRecords] = await Promise.all([
      prisma.sellfoxProductRecord.count({ where }),
      prisma.productRecord.count({ where: where as Prisma.ProductRecordWhereInput }),
      prisma.sellfoxProductRecord.findMany({
        where,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.productRecord.findMany({
        where: where as Prisma.ProductRecordWhereInput,
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    const products = [
      ...sellfoxRecords.map((record) => ({
        product: sellfoxProductRecordToProduct(record),
        updatedAt: record.updatedAt,
      })),
      ...legacyRecords.map((record) => ({
        product: sellfoxProductRecordToProduct({
          id: record.id,
          sku: record.sku,
          chineseName: record.chineseName,
          englishName: record.englishName,
          asin: record.asin,
          status: record.status,
          supplierName: record.supplierName,
          purchasePrice: record.purchasePrice,
          selectionOwner: record.selectionOwner,
          opsAssignee: record.opsAssignee,
          designerAssignee: record.designerAssignee,
          workflowStage: record.workflowStage,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          payload: record.payload,
        }),
        updatedAt: record.updatedAt,
      })),
    ]
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((entry) => entry.product)
      .slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

    return NextResponse.json({
      products,
      pagination: {
        page,
        pageSize,
        total: sellfoxTotal + legacyTotal,
        pageCount: Math.max(1, Math.ceil((sellfoxTotal + legacyTotal) / pageSize)),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取 Sellfox 商品失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
