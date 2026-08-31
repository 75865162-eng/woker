import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { createProductListItem, createProductListWhere, splitMultiValue } from "@/lib/products/list-query";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function csvEscape(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(rows: Array<Record<string, string | number | null | undefined>>) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0] ?? {});
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ];

  return `${lines.join("\n")}\n`;
}

function createExportKey() {
  return `exports/products/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.csv`;
}

function createDownloadUrl(fileId: string) {
  return `/api/files/${encodeURIComponent(fileId)}/download`;
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("products", "export", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const url = new URL(request.url);
    const scope = workspaceScopeFromRequest(request);
    const where = createProductListWhere({
      user,
      workspaceId: scope.workspaceId,
      search: url.searchParams.get("search")?.trim(),
      asin: url.searchParams.get("asin")?.trim(),
      status: url.searchParams.get("status") === "all" ? "" : url.searchParams.get("status"),
      supplierName: url.searchParams.get("supplierName")?.trim(),
      opsAssignees: splitMultiValue(url.searchParams.get("opsAssignees")),
      selectionOwners: splitMultiValue(url.searchParams.get("selectionOwners")),
      designerAssignees: splitMultiValue(url.searchParams.get("designerAssignees")),
      minPrice: Number(url.searchParams.get("minPrice")),
      maxPrice: Number(url.searchParams.get("maxPrice")),
    });

    const records = await prisma.productRecord.findMany({
      where,
      select: {
        id: true,
        sku: true,
        chineseName: true,
        englishName: true,
        status: true,
        selectionOwner: true,
        opsAssignee: true,
        designerAssignee: true,
        workflowStage: true,
        updatedAt: true,
        asin: true,
        supplierName: true,
        purchasePrice: true,
        workflowDueAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const rows = records.map((record) => {
      const listItem = createProductListItem(record);

      return {
        SKU: listItem.sku,
        中文名: listItem.chineseName,
        英文名: listItem.englishName,
        状态: listItem.status,
        当前负责人: listItem.currentOwner,
        更新时间: listItem.updatedAt,
        ASIN: record.asin,
        采购价格: record.purchasePrice,
        供应商名称: record.supplierName,
        选品负责人: record.selectionOwner,
        运营负责人: record.opsAssignee,
        美工负责人: record.designerAssignee,
        流程截止: record.workflowDueAt?.toISOString() ?? "",
      };
    });

    const csv = buildCsv(rows);
    const storageKey = createExportKey();
    const storedObject = await getStorageDriver().putBuffer({
      key: storageKey,
      buffer: Buffer.from(csv, "utf8"),
      contentType: "text/csv; charset=utf-8",
    });

    const fileObject = await prisma.fileObject.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        originalName: `products-${new Date().toISOString().slice(0, 10)}.csv`,
        mimeType: "text/csv; charset=utf-8",
        size: storedObject.size,
        storageKey: storedObject.key,
        storageType: getStorageType(),
        status: "done",
      },
    });

    const job = await prisma.importJob.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        fileId: fileObject.id,
        type: "product_export",
        status: "done",
        progress: 100,
      },
    });

    await prisma.exportRecord.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        fileId: fileObject.id,
        jobId: job.id,
        resultKey: storedObject.key,
        fileName: fileObject.originalName,
        mimeType: fileObject.mimeType,
        size: fileObject.size,
      },
    });

    await recordDataChangeVersion({
      user,
      entityType: "export_record",
      entityId: fileObject.id,
      action: "product_export",
      summary: fileObject.originalName,
      payload: {
        fileId: fileObject.id,
        fileName: fileObject.originalName,
        rowCount: rows.length,
        storageKey: storedObject.key,
        storageType: fileObject.storageType,
      } as unknown as Prisma.InputJsonValue,
      scope,
    });

    return NextResponse.json({
      file: {
        id: fileObject.id,
        name: fileObject.originalName,
        size: fileObject.size,
        storageType: fileObject.storageType,
        downloadUrl: createDownloadUrl(fileObject.id),
      },
      rowCount: rows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to export products.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
