import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { PRODUCT_ATTACHMENT_MAX_BYTES } from "@/lib/products/file-assets";
import type { ProductPatentAttachment } from "@/lib/products/types";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const imageExtensions = new Set([".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp"]);

function storageKey(fileName: string, variant: "original" | "thumb") {
  const extension = variant === "thumb" ? ".webp" : path.extname(fileName).toLowerCase() || ".bin";
  return `assets/products/patent-files/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${variant}${extension}`;
}

function downloadUrl(fileId: string) {
  return `/api/products/file-assets/${encodeURIComponent(fileId)}/download`;
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("products", "edit", request);
    if (!permission.ok) return permission.response;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "缺少专利附件。" }, { status: 400 });
    if (file.size > PRODUCT_ATTACHMENT_MAX_BYTES) return NextResponse.json({ error: "专利附件不能超过 10MB。" }, { status: 400 });

    const scope = workspaceScopeFromRequest(request, {
      workspaceId: formData.get("workspaceId"), accountId: formData.get("accountId"), marketplace: formData.get("marketplace"),
    });
    const buffer = Buffer.from(await file.arrayBuffer());
    const storage = getStorageDriver();
    const original = await storage.putBuffer({ key: storageKey(file.name, "original"), buffer, contentType: file.type || undefined });
    const originalFile = await prisma.fileObject.create({ data: {
      organizationId: permission.user.organizationId, userId: permission.user.id, workspaceId: scope.workspaceId, accountId: scope.accountId, marketplace: scope.marketplace,
      originalName: file.name, mimeType: file.type || original.contentType || "application/octet-stream", size: original.size, storageKey: original.key,
      storageType: getStorageType(), status: "done", productBindingStatus: "temporary",
    } });
    const extension = path.extname(file.name).toLowerCase();
    const isImage = (file.type.startsWith("image/") || imageExtensions.has(extension));
    let thumbFileId: string | undefined;
    let thumbUrl: string | undefined;
    if (isImage) {
      try {
        const thumb = await sharp(buffer).rotate().resize({ width: 160, height: 160, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
        const storedThumb = await storage.putBuffer({ key: storageKey(file.name, "thumb"), buffer: thumb, contentType: "image/webp" });
        const thumbFile = await prisma.fileObject.create({ data: {
          organizationId: permission.user.organizationId, userId: permission.user.id, workspaceId: scope.workspaceId, accountId: scope.accountId, marketplace: scope.marketplace,
          originalName: `${path.basename(file.name, extension)}-thumb.webp`, mimeType: "image/webp", size: storedThumb.size, storageKey: storedThumb.key,
          storageType: getStorageType(), status: "done", productBindingStatus: "temporary",
        } });
        thumbFileId = thumbFile.id;
        thumbUrl = downloadUrl(thumbFile.id);
      } catch {
        // A mislabeled image remains downloadable as an ordinary attachment.
      }
    }
    const asset: ProductPatentAttachment = {
      id: originalFile.id, name: originalFile.originalName, mimeType: originalFile.mimeType || "application/octet-stream", size: originalFile.size ?? original.size,
      storageType: originalFile.storageType, uploadedAt: originalFile.createdAt.toISOString(), downloadUrl: downloadUrl(originalFile.id), originalUrl: downloadUrl(originalFile.id),
      ...(thumbUrl ? { thumbUrl } : {}), ...(thumbFileId ? { thumbFileId } : {}),
    };
    return NextResponse.json({ asset });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "专利附件上传失败。" }, { status: 500 });
  }
}
