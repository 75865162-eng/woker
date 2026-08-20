import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const supportedAssetTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
]);
const supportedAssetExtensions = new Set([".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
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
    const user = await getCurrentUser(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const permissions = await getOrganizationRolePermissions(user.organizationId);
    const canUploadAsset =
      roleCanPerformAction(user.role, "listingAi", "create", permissions) ||
      roleCanPerformAction(user.role, "products", "edit", permissions);

    if (!canUploadAsset) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

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

    if (!supportedAssetExtensions.has(extension) || (file.type && !supportedAssetTypes.has(file.type))) {
      return NextResponse.json({ error: "Only image or PDF files are supported." }, { status: 400 });
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
