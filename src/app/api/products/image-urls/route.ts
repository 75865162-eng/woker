import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageType } from "@/lib/storage";
import { createS3PresignedGetUrl } from "@/lib/storage/s3-storage";
import { hasAuthorizedProductImageFiles, normalizeProductImageFileIds } from "@/lib/products/image-url-access";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const signedUrlTtlSeconds = 600;
const maxFileIds = 100;

function legacyAssetUrl(storageKey: string, scope: { workspaceId: string; accountId: string; marketplace: string }) {
  const params = new URLSearchParams({ workspaceId: scope.workspaceId });
  if (scope.accountId) params.set("accountId", scope.accountId);
  if (scope.marketplace) params.set("marketplace", scope.marketplace);
  return `/api/assets/${storageKey.split("/").map(encodeURIComponent).join("/")}?${params.toString()}`;
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("products", "view", request);
    if (!permission.ok) return permission.response;

    const body = (await request.json().catch(() => ({}))) as { fileIds?: unknown };
    const fileIds = normalizeProductImageFileIds(body.fileIds, maxFileIds);
    if (!fileIds.length || fileIds.length > maxFileIds) {
      return NextResponse.json({ error: `请提供 1 至 ${maxFileIds} 个图片文件。` }, { status: 400 });
    }

    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const files = await prisma.fileObject.findMany({
      where: {
        id: { in: fileIds },
        organizationId: permission.user.organizationId,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
      },
      select: { id: true, storageKey: true, storageType: true },
    });

    // Do not reveal whether a missing id belongs to another tenant or account.
    if (!hasAuthorizedProductImageFiles(fileIds, files.map((file) => file.id))) {
      return NextResponse.json({ error: "无权读取一个或多个商品图片。" }, { status: 403 });
    }

    const storageType = getStorageType();
    const expiresAt = new Date(Date.now() + signedUrlTtlSeconds * 1000).toISOString();
    const urls = await Promise.all(files.map(async (file) => ({
      fileId: file.id,
      // Local storage has no browser-reachable object host. Production R2/S3 always uses a signed direct URL.
      url: storageType === "local" || file.storageType === "local"
        ? legacyAssetUrl(file.storageKey, scope)
        : await createS3PresignedGetUrl(file.storageKey, signedUrlTtlSeconds),
    })));

    return NextResponse.json({ urls, expiresAt }, {
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品图片链接签发失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
