import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { createProductListWhere, hasStandardProductStatus, splitMultiValue } from "@/lib/products/list-query";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { sellfoxProductRecordToProduct } from "@/lib/sellfox/product-records";

export const runtime = "nodejs";

function clampPageSize(value: string | null) {
  const pageSize = Number(value) || 50;
  return Math.min(Math.max(pageSize, 1), 200);
}

function parseOptionalNumber(value: string | null) {
  const text = value?.trim();
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

function parseFilters(url: URL, organizationId: string, workspaceId: string) {
  return {
    user: { organizationId },
    workspaceId,
    search: url.searchParams.get("search")?.trim(),
    asin: url.searchParams.get("asin")?.trim(),
    status: url.searchParams.get("status") === "all" ? "" : url.searchParams.get("status"),
    supplierName: url.searchParams.get("supplierName")?.trim(),
    opsAssignees: splitMultiValue(url.searchParams.get("opsAssignees")),
    selectionOwners: splitMultiValue(url.searchParams.get("selectionOwners")),
    designerAssignees: splitMultiValue(url.searchParams.get("designerAssignees")),
    minPrice: parseOptionalNumber(url.searchParams.get("minPrice")),
    maxPrice: parseOptionalNumber(url.searchParams.get("maxPrice")),
  };
}

function createSellfoxWhere(input: ReturnType<typeof parseFilters>) {
  const closedStatuses = ["listed", "canceled", "delisted", "patent_risk"];
  const and: Prisma.SellfoxProductRecordWhereInput[] = [];
  const where: Prisma.SellfoxProductRecordWhereInput = {
    organizationId: input.user.organizationId,
    workspaceId: input.workspaceId,
  };

  if (input.search) {
    and.push({
      OR: [
        { sku: { contains: input.search, mode: "insensitive" } },
        { id: { contains: input.search, mode: "insensitive" } },
        { chineseName: { contains: input.search, mode: "insensitive" } },
        { englishName: { contains: input.search, mode: "insensitive" } },
      ],
    });
  }

  if (input.asin) where.asin = { contains: input.asin, mode: "insensitive" };
  if (input.supplierName) where.supplierName = { contains: input.supplierName, mode: "insensitive" };
  if (input.opsAssignees.length) where.opsAssignee = { in: input.opsAssignees };
  if (input.selectionOwners.length) where.selectionOwner = { in: input.selectionOwners };
  if (input.designerAssignees.length) where.designerAssignee = { in: input.designerAssignees };
  if (input.minPrice !== undefined || input.maxPrice !== undefined) {
    where.purchasePrice = {
      ...(input.minPrice !== undefined ? { gte: input.minPrice } : {}),
      ...(input.maxPrice !== undefined ? { lte: input.maxPrice } : {}),
    };
  }

  if (input.status === "operations_progress") {
    where.operationsProgressIncomplete = true;
  } else if (input.status === "overdue") {
    where.status = { notIn: closedStatuses };
    where.workflowDueAt = { lt: new Date() };
  } else {
    const standardStatus = input.status ?? null;
    if (hasStandardProductStatus(standardStatus)) {
      where.status = standardStatus;
    }
  }

  if (and.length) where.AND = and;
  return where;
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
    const filters = parseFilters(url, user.organizationId, scope.workspaceId);
    const sellfoxWhere = createSellfoxWhere(filters);
    const legacyWhere = createProductListWhere({
      ...filters,
      source: "sellfox",
    });
    const takeForMerge = page * pageSize;

    const [sellfoxTotal, legacyTotal, sellfoxRecords, legacyRecords] = await Promise.all([
      prisma.sellfoxProductRecord.count({ where: sellfoxWhere }),
      prisma.productRecord.count({ where: legacyWhere }),
      prisma.sellfoxProductRecord.findMany({
        where: sellfoxWhere,
        orderBy: { updatedAt: "desc" },
        take: takeForMerge,
      }),
      prisma.productRecord.findMany({
        where: legacyWhere,
        orderBy: { updatedAt: "desc" },
        take: takeForMerge,
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
