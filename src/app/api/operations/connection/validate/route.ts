import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { validateAmazonConnection } from "@/lib/operations/readiness";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("operations", "edit", request);
    if (!permission.ok) return permission.response;

    const result = await validateAmazonConnection({
      user: permission.user,
      scope: workspaceScopeFromRequest(request),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "SP-API 服务端配置验证失败。" }, { status: 409 });
  }
}
