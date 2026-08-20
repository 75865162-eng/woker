import path from "node:path";
import { NextResponse } from "next/server";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
};

function getContentType(key: string) {
  return contentTypes[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

function isValidAssetKey(keyParts: string[]) {
  return (
    keyParts.length > 1 &&
    keyParts[0] === "assets" &&
    keyParts.every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\\"))
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    const user = await getCurrentUser(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const permissions = await getOrganizationRolePermissions(user.organizationId);
    const canViewAsset =
      roleCanPerformAction(user.role, "listingAi", "view", permissions) ||
      roleCanPerformAction(user.role, "products", "view", permissions);

    if (!canViewAsset) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { key: keyParts } = await params;

    if (!isValidAssetKey(keyParts)) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    const key = keyParts.join("/");
    if (process.env.DATABASE_URL) {
      const fileObject = await prisma.fileObject.findFirst({
        where: {
          storageKey: key,
          organizationId: user.organizationId,
        },
      });

      if (!fileObject) {
        return NextResponse.json({ error: "Asset not found." }, { status: 404 });
      }
    }

    const buffer = await getStorageDriver().getBuffer(key);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": getContentType(key),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Asset download failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
