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
    const { user } = permission;

    const { id } = await params;
    const file = await prisma.fileObject.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
      },
    });

    if (!file) {
      return NextResponse.json({ error: "结论 Excel 文件不存在。" }, { status: 404 });
    }

    const buffer = await getStorageDriver().getBuffer(file.storageKey);
    const fileName = encodeURIComponent(file.originalName);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "结论 Excel 下载失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
