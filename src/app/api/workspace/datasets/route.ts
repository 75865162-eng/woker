import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("workspace", "view");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const url = new URL(request.url);
    const scope = workspaceScopeFromRequest(request);
    const id = url.searchParams.get("id")?.trim();
    const jobId = url.searchParams.get("jobId")?.trim();

    const dataset = await prisma.workspaceDataset.findFirst({
      where: {
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
        ...(scope.accountId ? { accountId: scope.accountId } : {}),
        ...(scope.marketplace ? { marketplace: scope.marketplace } : {}),
        ...(id ? { id } : {}),
        ...(jobId ? { jobId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ dataset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load workspace dataset.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
