import path from "node:path";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requireApiPermission("products", "view", request);
    if (!permission.ok) {
      return permission.response;
    }

    const { id } = await params;
    const fileObject = await prisma.fileObject.findFirst({
      where: {
        id,
        organizationId: permission.user.organizationId,
      },
    });
    if (!fileObject) {
      return NextResponse.json({ error: "商品附件不存在。" }, { status: 404 });
    }

    const buffer = await getStorageDriver().getBuffer(fileObject.storageKey);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${encodeURIComponent(fileObject.originalName)}"`,
        "Content-Type": fileObject.mimeType || `application/${path.extname(fileObject.originalName).slice(1) || "octet-stream"}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品附件下载失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
