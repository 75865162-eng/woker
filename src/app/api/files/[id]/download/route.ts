import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requireApiPermission("workspace", "export", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const { id } = await params;
    const job = await prisma.importJob.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        workspaceId: workspaceScopeFromRequest(request).workspaceId,
        userId: user.id,
        file: {
          organizationId: user.organizationId,
          workspaceId: workspaceScopeFromRequest(request).workspaceId,
          userId: user.id,
        },
      },
      include: { file: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    if (job.status !== "done" || !job.resultKey) {
      return NextResponse.json({ error: "Job result is not ready." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const buffer = await getStorageDriver().getBuffer(job.resultKey);
    await prisma.auditLog.create({ data: { organizationId: user.organizationId, userId: user.id, action: "import.result.downloaded", entityType: "ImportJob", entityId: job.id, metadata: { workspaceId: job.workspaceId, fileId: job.fileId } } });
    const body = new Uint8Array(buffer);
    const baseName = job.file.originalName.replace(/\.[^.]+$/, "");
    const fileName = encodeURIComponent(`${baseName}-optimized.xlsx`);

    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
      },
    });
  } catch (error) {
    void error;
    return NextResponse.json({ error: "Download failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
