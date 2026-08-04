import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const supportedImageExtensions = new Set([".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp"]);
const maxAssetSize = 50 * 1024 * 1024;

function createAssetKey(fileName: string) {
  const extension = path.extname(fileName).toLowerCase() || ".bin";
  return `assets/listing-ai/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
}

function createAssetUrl(key: string) {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "create");

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
      return NextResponse.json({ error: "Missing upload file." }, { status: 400 });
    }

    const extension = path.extname(file.name).toLowerCase();

    if (!supportedImageExtensions.has(extension) || (file.type && !supportedImageTypes.has(file.type))) {
      return NextResponse.json({ error: "Only image files are supported." }, { status: 400 });
    }

    if (file.size > maxAssetSize) {
      return NextResponse.json({ error: "图片不能超过 50MB。" }, { status: 400 });
    }

    const key = createAssetKey(file.name);
    const storedObject = await getStorageDriver().putFile({ key, file });

    if (process.env.DATABASE_URL) {
      await prisma.fileObject.create({
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
    }

    return NextResponse.json({
      asset: {
        id: storedObject.key,
        name: file.name,
        type: file.type || storedObject.contentType || "application/octet-stream",
        size: storedObject.size,
        createdAt: new Date().toISOString(),
        url: createAssetUrl(storedObject.key),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Asset upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
