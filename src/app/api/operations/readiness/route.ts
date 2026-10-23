import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getOperationsReadiness } from "@/lib/operations/readiness";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("operations", "view", request);
    if (!permission.ok) return permission.response;

    return NextResponse.json(await getOperationsReadiness({
      organizationId: permission.user.organizationId,
      scope: workspaceScopeFromRequest(request),
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "经营中台状态读取失败。" }, { status: 500 });
  }
}
