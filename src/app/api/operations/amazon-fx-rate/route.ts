import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { WmsError } from "@/lib/wms/contracts";
import { queryFxRates, mutateFxRates, deleteFxRate } from "@/lib/amazon-sync/fx-rate-service";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

async function handleError(error: unknown) {
  if (error instanceof WmsError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error("[operations.amazon-fx-rate]", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  return NextResponse.json({ error: "汇率配置服务暂不可用。" }, { status: 500, headers });
}

export async function GET(request: Request) {
  const permission = await requireApiPermission("operations", "view", request);
  if (!permission.ok) return permission.response;
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: permission.user.id };
    const items = await queryFxRates(scope);
    return NextResponse.json({ items }, { headers });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request) {
  const permission = await requireApiPermission("operations", "edit", request);
  if (!permission.ok) return permission.response;
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: permission.user.id };
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const items = body.items ?? body;
    const result = await mutateFxRates(scope, items);
    return NextResponse.json(result, { headers });
  } catch (error) { return handleError(error); }
}

export async function DELETE(request: Request) {
  const permission = await requireApiPermission("operations", "edit", request);
  if (!permission.ok) return permission.response;
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: permission.user.id };
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const result = await deleteFxRate(scope, id);
    return NextResponse.json(result, { headers });
  } catch (error) { return handleError(error); }
}
