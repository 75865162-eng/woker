import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import type { ProductFileAsset } from "@/lib/products/types";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const supportedExtensions = new Set([".xls", ".xlsx", ".xlsm"]);
const maxUploadSize = 50 * 1024 * 1024;

function createStorageKey(fileName: string) {
  const extension = path.extname(fileName).toLowerCase() || ".xlsx";
  return `products/conclusion-excel/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
}

function createDownloadUrl(fileId: string) {
  return `/api/products/conclusion-files/${encodeURIComponent(fileId)}/download`;
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("products", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const formData = await request.formData();
    const file = formData.get("file");
    const scope = workspaceScopeFromRequest(request, {
      workspaceId: formData.get("workspaceId"),
      accountId: formData.get("accountId"),
      marketplace: formData.get("marketplace"),
    });

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少结论 Excel 文件。" }, { status: 400 });
    }

    const extension = path.extname(file.name).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      return NextResponse.json({ error: "结论文件仅支持 .xlsx、.xls、.xlsm。" }, { status: 400 });
    }

    if (file.size > maxUploadSize) {
      return NextResponse.json({ error: "结论 Excel 不能超过 50MB。" }, { status: 400 });
    }

    const storedObject = await getStorageDriver().putFile({ key: createStorageKey(file.name), file });
    const fileObject = await prisma.fileObject.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        originalName: file.name,
        mimeType: file.type || storedObject.contentType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: storedObject.size,
        storageKey: storedObject.key,
        storageType: getStorageType(),
        status: "done",
      },
    });

    const asset: ProductFileAsset = {
      id: fileObject.id,
      name: fileObject.originalName,
      mimeType: fileObject.mimeType || "application/octet-stream",
      size: fileObject.size ?? storedObject.size,
      storageType: fileObject.storageType,
      uploadedAt: fileObject.createdAt.toISOString(),
      downloadUrl: createDownloadUrl(fileObject.id),
    };

    return NextResponse.json({ file: asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "结论 Excel 上传失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
