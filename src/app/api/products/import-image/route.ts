import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getProductEditRestrictionMessage } from "@/lib/products/product-edit-access";
import type { Product } from "@/lib/products/types";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const supportedImageTypes = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const contentTypeExtensions: Record<string, string> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const maxAssetSize = 50 * 1024 * 1024;
const blockedHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function createAssetKey(sku: string, url: URL, contentType: string) {
  const extensionFromUrl = path.extname(url.pathname).toLowerCase();
  const extension = extensionFromUrl && extensionFromUrl.length <= 6 ? extensionFromUrl : contentTypeExtensions[contentType] ?? ".jpg";
  const normalizedSku = sku.replace(/[^a-z0-9_-]/giu, "-").slice(0, 80) || "product";
  return `assets/products/${new Date().toISOString().slice(0, 10)}/${normalizedSku}-${randomUUID()}${extension}`;
}

function createAssetUrl(key: string) {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function parseRemoteImageUrl(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (blockedHosts.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission(request, "products", "edit");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;
    const body = (await request.json()) as { url?: unknown; sku?: unknown; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };
    const remoteUrl = parseRemoteImageUrl(body.url);
    const sku = String(body.sku ?? "").trim();

    if (!remoteUrl || !sku) {
      return NextResponse.json({ error: "Missing valid image url or SKU." }, { status: 400 });
    }

    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const productRecord = await prisma.productRecord.findUnique({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          sku,
        },
      },
    });
    const product = productRecord?.payload as unknown as Product | undefined;
    const editRestriction = product ? getProductEditRestrictionMessage(product, user, "edit_design") : "";

    if (editRestriction) {
      return NextResponse.json({ error: editRestriction }, { status: 403 });
    }

    const response = await fetch(remoteUrl, {
      headers: {
        "User-Agent": "AmazonBulkAdWorkbench/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Remote image download failed: ${response.status}` }, { status: 502 });
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    const contentLength = Number(response.headers.get("content-length"));

    if (!supportedImageTypes.has(contentType)) {
      return NextResponse.json({ error: "Remote file is not a supported image." }, { status: 400 });
    }

    if (Number.isFinite(contentLength) && contentLength > maxAssetSize) {
      return NextResponse.json({ error: "图片不能超过 50MB。" }, { status: 400 });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength > maxAssetSize) {
      return NextResponse.json({ error: "图片不能超过 50MB。" }, { status: 400 });
    }

    const key = createAssetKey(sku, remoteUrl, contentType);
    const storedObject = await getStorageDriver().putBuffer({ key, buffer, contentType });

    if (process.env.DATABASE_URL) {
      await prisma.fileObject.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          originalName: path.basename(remoteUrl.pathname) || `${sku}${contentTypeExtensions[contentType] ?? ".jpg"}`,
          mimeType: contentType,
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
        sourceUrl: remoteUrl.toString(),
        url: createAssetUrl(storedObject.key),
        type: contentType,
        size: storedObject.size,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product image import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
