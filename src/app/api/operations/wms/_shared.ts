import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { getAuthDriver } from "@/lib/auth/constants";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export async function wmsRequestScope(request: Request, body?: Record<string, unknown>) {
  const user = getAuthDriver() === "database" ? await getCurrentUserFromRequest(request) : undefined;
  if (!user) return { response: NextResponse.json({ error: "请使用数据库会话登录。" }, { status: 401 }) } as const;
  const workspaceId = workspaceScopeFromRequest(request, body).workspaceId;
  return {
    scope: { organizationId: user.organizationId, workspaceId, actorUserId: user.id },
  } as const;
}

export function wmsErrorResponse(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2025", "P2034"].includes(error.code)) return NextResponse.json({ error: "记录冲突或关联已变化，请刷新后重试。" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
  const message = error instanceof Error ? error.message : "WMS 请求失败。";
  if (status >= 500) console.error("[operations.wms]", { name: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: status >= 500 ? "WMS 服务暂不可用。" : message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJson(request: Request) {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("请求内容须为 JSON 对象。"), { status: 400 });
  }
}
