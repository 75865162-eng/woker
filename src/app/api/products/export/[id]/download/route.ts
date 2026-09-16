import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requireApiPermission("products", "export", request);

    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;
    const { id } = await params;
    const job = await prisma.importJob.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        type: "product_export",
        file: {
          organizationId: user.organizationId,
        },
      },
      include: { file: true },
    });

    if (!job) {
      return NextResponse.json({ error: "商品导出任务不存在。" }, { status: 404 });
    }

    if (job.status !== "done" || !job.resultKey) {
      return NextResponse.json({ error: "商品导出文件尚未准备完成。" }, { status: 409 });
    }

    const buffer = await getStorageDriver().getBuffer(job.resultKey);
    const fileName = encodeURIComponent(job.file.originalName);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品导出文件下载失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
