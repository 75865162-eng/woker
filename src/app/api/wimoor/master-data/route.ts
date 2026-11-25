import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import {
  queryEntries, mutateEntries, queryDocuments, mutateDocuments,
} from "@/lib/wimoor-migration/master-data-service";
import { WmsError } from "@/lib/wms/contracts";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

function errorResponse(error: unknown) {
  if (error instanceof WmsError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return NextResponse.json({ error: error.code === "P2002" ? "编码已存在。" : "数据冲突，请刷新后重试。" }, { status: 409 });
  }
  console.error("[wimoor.master-data]", { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) });
  return NextResponse.json({ error: "主数据服务暂不可用。" }, { status: 500 });
}

export async function GET(request: Request) {
  const auth = await requireApiPermission("operations", "view", request);
  if (!auth.ok) return auth.response;
  const scope = {
    organizationId: auth.user.organizationId,
    workspaceId: workspaceScopeFromRequest(request).workspaceId,
    actorUserId: auth.user.id,
  };
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "entry";
    if (type === "document") return NextResponse.json(await queryDocuments(scope, url.searchParams), { headers });
    return NextResponse.json(await queryEntries(scope, url.searchParams), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.clone().json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid body");
    body = value as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "请求内容无效。" }, { status: 400 }); }

  const action = String(body.action ?? "");
  const needApprove = action === "transition";
  const auth = await requireApiPermission("operations", needApprove ? "approve" : "create", request);
  if (!auth.ok) return auth.response;
  const scope = {
    organizationId: auth.user.organizationId,
    workspaceId: workspaceScopeFromRequest(request).workspaceId,
    actorUserId: auth.user.id,
  };
  try {
    const type = String(body.type ?? "entry");
    if (type === "document") return NextResponse.json(await mutateDocuments(scope, body), { headers });
    return NextResponse.json(await mutateEntries(scope, body), { headers });
  } catch (error) { return errorResponse(error); }
}
