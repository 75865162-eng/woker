import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";

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

    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        error: job.error,
        file: {
          originalName: job.file.originalName,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品导出任务状态读取失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
