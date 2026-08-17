import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requireApiPermission(request, "workspace", "export");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const { id } = await params;
    const scope = workspaceScopeFromRequest(request);
    const job = await prisma.importJob.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
        ...(scope.accountId ? { accountId: scope.accountId } : {}),
        ...(scope.marketplace ? { marketplace: scope.marketplace } : {}),
        file: {
          organizationId: user.organizationId,
        },
      },
      include: { file: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    if (job.status !== "done" || !job.resultKey) {
      return NextResponse.json({ error: "Job result is not ready." }, { status: 409 });
    }

    const buffer = await getStorageDriver().getBuffer(job.resultKey);
    const body = new Uint8Array(buffer);
    const baseName = job.file.originalName.replace(/\.[^.]+$/, "");
    const fileName = encodeURIComponent(`${baseName}-optimized.xlsx`);

    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
