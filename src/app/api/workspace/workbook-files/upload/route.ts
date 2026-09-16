import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const supportedExtensions = new Set([".csv", ".xls", ".xlsm", ".xlsx"]);
const maxUploadSize = 50 * 1024 * 1024;

function createStorageKey(fileName: string) {
  const extension = path.extname(fileName).toLowerCase() || ".xlsx";
  return `workspaces/workbooks/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("workspace", "edit", request);

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
      return NextResponse.json({ error: "缺少工作簿文件。" }, { status: 400 });
    }

    if (!supportedExtensions.has(path.extname(file.name).toLowerCase())) {
      return NextResponse.json({ error: "仅支持 .xlsx、.xls、.xlsm、.csv 文件。" }, { status: 400 });
    }

    if (file.size > maxUploadSize) {
      return NextResponse.json({ error: "工作簿文件不能超过 50MB。" }, { status: 400 });
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
        mimeType: file.type || storedObject.contentType || undefined,
        size: storedObject.size,
        storageKey: storedObject.key,
        storageType: getStorageType(),
        status: "done",
      },
    });

    return NextResponse.json({
      file: {
        id: fileObject.id,
        name: fileObject.originalName,
        mimeType: fileObject.mimeType || "application/octet-stream",
        size: fileObject.size ?? storedObject.size,
        storageType: fileObject.storageType,
        uploadedAt: fileObject.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "工作簿文件上传失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
