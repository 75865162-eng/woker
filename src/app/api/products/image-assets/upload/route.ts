import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const supportedImageTypes = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const supportedImageExtensions = new Set([".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp"]);
const maxImageSize = 50 * 1024 * 1024;

function createAssetKey(fileName: string) {
  const extension = path.extname(fileName).toLowerCase() || ".bin";
  return `assets/products/images/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
}

function createAssetUrl(key: string) {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
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
      return NextResponse.json({ error: "缺少商品图片文件。" }, { status: 400 });
    }

    const extension = path.extname(file.name).toLowerCase();
    if (!supportedImageExtensions.has(extension) || (file.type && !supportedImageTypes.has(file.type))) {
      return NextResponse.json({ error: "商品图片仅支持 JPG、PNG、WEBP、GIF、AVIF。" }, { status: 400 });
    }

    if (file.size > maxImageSize) {
      return NextResponse.json({ error: "商品图片不能超过 50MB。" }, { status: 400 });
    }

    const storedObject = await getStorageDriver().putFile({ key: createAssetKey(file.name), file });
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
      asset: {
        id: fileObject.id,
        name: fileObject.originalName,
        mimeType: fileObject.mimeType || "application/octet-stream",
        size: fileObject.size ?? storedObject.size,
        storageType: fileObject.storageType,
        uploadedAt: fileObject.createdAt.toISOString(),
        url: createAssetUrl(fileObject.storageKey),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品图片上传失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
