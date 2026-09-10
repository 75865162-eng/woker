import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { PRODUCT_ATTACHMENT_MAX_BYTES } from "@/lib/products/file-assets";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import type { ProductImageAsset } from "@/lib/products/types";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const imageExtensions = new Set([".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp"]);
const documentExtensions = new Set([".csv", ".pdf", ".xls", ".xlsm", ".xlsx"]);
const imageMimeTypes = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

function createStorageKey(fileName: string, variant: "original" | "thumb") {
  const extension = variant === "thumb" ? ".webp" : path.extname(fileName).toLowerCase() || ".bin";
  return `assets/products/attachments/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${variant}${extension}`;
}

function createDownloadUrl(fileId: string) {
  return `/api/products/file-assets/${encodeURIComponent(fileId)}/download`;
}

function createAssetUrl(key: string) {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function isSupportedFile(file: File) {
  const extension = path.extname(file.name).toLowerCase();
  return imageExtensions.has(extension) || documentExtensions.has(extension);
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

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少商品附件文件。" }, { status: 400 });
    }
    if (!isSupportedFile(file)) {
      return NextResponse.json({ error: "商品附件仅支持图片、PDF、Excel 或 CSV 文件。" }, { status: 400 });
    }
    if (file.size > PRODUCT_ATTACHMENT_MAX_BYTES) {
      return NextResponse.json({ error: "商品附件不能超过 10MB。" }, { status: 400 });
    }

    const scope = workspaceScopeFromRequest(request, {
      workspaceId: formData.get("workspaceId"),
      accountId: formData.get("accountId"),
      marketplace: formData.get("marketplace"),
    });
    const extension = path.extname(file.name).toLowerCase();
    const isImage = imageExtensions.has(extension) && (!file.type || imageMimeTypes.has(file.type));
    const storage = getStorageDriver();
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const originalObject = await storage.putBuffer({
      key: createStorageKey(file.name, "original"),
      buffer: fileBuffer,
      contentType: file.type || undefined,
    });
    const fileObject = await prisma.fileObject.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        originalName: file.name,
        mimeType: file.type || originalObject.contentType || "application/octet-stream",
        size: originalObject.size,
        storageKey: originalObject.key,
        storageType: getStorageType(),
        status: "done",
      },
    });

    let thumbUrl: string | undefined;
    if (isImage) {
      const thumbBuffer = await sharp(fileBuffer)
        .rotate()
        .resize({ width: 160, height: 160, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      const thumbObject = await storage.putBuffer({
        key: createStorageKey(file.name, "thumb"),
        buffer: thumbBuffer,
        contentType: "image/webp",
      });
      const thumbFileObject = await prisma.fileObject.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          originalName: `${path.basename(file.name, extension)}-thumb.webp`,
          mimeType: "image/webp",
          size: thumbObject.size,
          storageKey: thumbObject.key,
          storageType: getStorageType(),
          status: "done",
        },
      });
      thumbUrl = createAssetUrl(thumbFileObject.storageKey);
    }

    const originalUrl = createAssetUrl(fileObject.storageKey);
    const asset: ProductImageAsset & { downloadUrl: string } = {
      id: fileObject.id,
      name: fileObject.originalName,
      mimeType: fileObject.mimeType || "application/octet-stream",
      size: fileObject.size ?? originalObject.size,
      storageType: fileObject.storageType,
      uploadedAt: fileObject.createdAt.toISOString(),
      thumbUrl: thumbUrl || originalUrl,
      originalUrl,
      downloadUrl: createDownloadUrl(fileObject.id),
    };

    return NextResponse.json({ asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品附件上传失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
