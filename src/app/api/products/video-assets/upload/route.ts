import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import type { ProductVideoAsset } from "@/lib/products/video-plan";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const supportedExtensions = new Set([
  ".avif",
  ".gif",
  ".jpg",
  ".jpeg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".png",
  ".wav",
  ".webm",
  ".webp",
]);
const maxAssetSize = 200 * 1024 * 1024;

function createAssetKey(fileName: string) {
  const extension = path.extname(fileName).toLowerCase() || ".bin";
  return `products/video-assets/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
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
      return NextResponse.json({ error: "缺少视频策划素材文件。" }, { status: 400 });
    }

    if (!supportedExtensions.has(path.extname(file.name).toLowerCase())) {
      return NextResponse.json({ error: "仅支持图片、MP3、WAV、MOV、MP4、WEBM 等素材文件。" }, { status: 400 });
    }

    if (file.size > maxAssetSize) {
      return NextResponse.json({ error: "素材文件不能超过 200MB。" }, { status: 400 });
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

    const asset: ProductVideoAsset = {
      id: fileObject.id,
      name: fileObject.originalName,
      mimeType: fileObject.mimeType || "application/octet-stream",
      size: fileObject.size ?? storedObject.size,
      url: createAssetUrl(storedObject.key),
      uploadedAt: fileObject.createdAt.toISOString(),
    };

    return NextResponse.json({ asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频策划素材上传失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
