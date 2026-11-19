import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { SellfoxCredentialError } from "@/lib/sellfox/credential-crypto";
import { disableSellfoxAuthorization, getSellfoxCredentialStatus, saveSellfoxCredentials, sellfoxCredentialAccess } from "@/lib/sellfox/credential-store";
import { activateSellfoxSyncAfterSave } from "@/lib/sellfox/sync-activation";
import { isSellfoxSameOrigin } from "@/lib/sellfox/request-origin";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof SellfoxCredentialError ? error.message : "赛狐配置暂不可用，请管理员检查数据库连接与当前版本迁移。" }, { status: error instanceof SellfoxCredentialError ? error.status : 503, headers });
}
async function context(request: Request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) throw new SellfoxCredentialError("请先登录。", 401);
  if (!process.env.DATABASE_URL) throw new SellfoxCredentialError("赛狐配置需要服务端数据库，请管理员先完成数据库配置。", 503);
  return { actor: user.id, scope: { organizationId: user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId } };
}
export async function GET(request: Request) {
  try {
    const { actor, scope } = await context(request);
    const result = await prisma.$transaction(async tx => ({ ...(await sellfoxCredentialAccess(scope, actor, tx)), ...(await getSellfoxCredentialStatus(scope, tx)) }));
    return NextResponse.json({ ...result, scope }, { headers });
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    if (!isSellfoxSameOrigin(request)) throw new SellfoxCredentialError("不接受跨站凭据保存请求。", 403);
    const { actor, scope } = await context(request);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new SellfoxCredentialError("请使用 JSON 提交凭据。", 415);
    if (Number(request.headers.get("content-length")) > 100_000) throw new SellfoxCredentialError("凭据请求过大。", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new SellfoxCredentialError("缺少凭据内容。");
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 100_000) { await reader.cancel(); throw new SellfoxCredentialError("凭据请求过大。", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
      body = parsed as Record<string, unknown>;
    } catch { throw new SellfoxCredentialError("凭据 JSON 格式无效。"); }
    if (Object.keys(body).some(key => !["clientId", "clientSecret", "revision"].includes(key))) throw new SellfoxCredentialError("提交内容包含不支持的字段。");
    const result = await saveSellfoxCredentials(scope, actor, { clientId: body.clientId, clientSecret: body.clientSecret }, body.revision as number);
    // 保存已提交后才尝试自动激活；激活失败不回滚凭据，连通性结果随响应返回供前端明确展示。
    let activation: { activated: boolean; connected: boolean; storesStarted: boolean; fullSyncCreated: number; fullSyncError: string | null; message: string } | null = null;
    let activationError: string | null = null;
    try {
      activation = await activateSellfoxSyncAfterSave(scope, actor, result.revision);
    } catch (activationFailure) {
      activationError = activationFailure instanceof Error ? activationFailure.message : "凭据已保存，但自动校验与启动未完成，请稍后手动测试连接。";
    }
    return NextResponse.json({ ...result, configured: true, source: "database", activation, activationError }, { headers });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    if (!isSellfoxSameOrigin(request)) throw new SellfoxCredentialError("不接受跨站停用请求。", 403);
    const { actor, scope } = await context(request);
    const revision = Number(request.headers.get("x-credential-revision"));
    const result = await disableSellfoxAuthorization(scope, actor, revision);
    return NextResponse.json({ ...result, configured: false }, { headers });
  } catch (error) { return failure(error); }
}
