import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requireApiPermission("workspace", "view");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const { id } = await params;
    const scope = workspaceScopeFromRequest(_request);
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

    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load job.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
