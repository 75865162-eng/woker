import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { SellfoxCredentialError } from "@/lib/sellfox/credential-crypto";
import { runSellfoxConnectionTest } from "@/lib/sellfox/connection-test";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new SellfoxCredentialError("不接受跨站连接测试请求。", 403);
    const user = await getCurrentUserFromRequest(request);
    if (!user) throw new SellfoxCredentialError("请先登录。", 401);
    if (!process.env.DATABASE_URL) throw new SellfoxCredentialError("服务端数据库尚未配置。", 503);
    const rawRevision = request.headers.get("x-credential-revision");
    if (!rawRevision || !/^\d+$/.test(rawRevision)) throw new SellfoxCredentialError("请重新读取凭据配置后再测试。", 409);
    const scope = { organizationId: user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    return NextResponse.json(await runSellfoxConnectionTest(scope, user.id, Number(rawRevision)), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SellfoxCredentialError ? error.message : "连接测试未完成，请检查服务端状态后重试。" }, { status: error instanceof SellfoxCredentialError ? error.status : 503, headers });
  }
}
