import path from "node:path";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function getContentType(key: string) {
  return contentTypes[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

function isValidAssetKey(keyParts: string[]) {
  const validParts = keyParts.every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\\"));
  return validParts && (
    (keyParts.length > 1 && keyParts[0] === "assets")
    || (keyParts.length > 2 && keyParts[0] === "products" && keyParts[1] === "video-assets")
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    const { key: keyParts } = await params;
    const productAsset = keyParts[1] === "products" || (keyParts[0] === "products" && keyParts[1] === "video-assets");
    const permission = await requireApiPermission(productAsset ? "products" : "listingAi", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    if (!isValidAssetKey(keyParts)) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    const key = keyParts.join("/");
    if (process.env.DATABASE_URL) {
      const scope = productAsset ? workspaceScopeFromRequest(request) : null;
      const fileObject = await prisma.fileObject.findFirst({
        where: {
          storageKey: key,
          organizationId: user.organizationId,
          ...(scope ? { workspaceId: scope.workspaceId, accountId: scope.accountId } : {}),
        },
      });

      if (!fileObject) {
        return NextResponse.json({ error: productAsset ? "无权读取该商品图片。" : "Asset not found." }, { status: productAsset ? 403 : 404 });
      }
    }

    const buffer = await getStorageDriver().getBuffer(key);

    const headers: Record<string, string> = {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": getContentType(key),
    };
    // Product image rendering now uses /api/products/image-urls and a direct signed object URL.
    // This proxy remains only for local storage and legacy persisted image references.
    if (keyParts[1] === "products") headers.Deprecation = "true";
    return new Response(new Uint8Array(buffer), {
      headers: {
        ...headers,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Asset download failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
