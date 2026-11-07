import { NextResponse } from "next/server";
import { boundedJsonObject, boundedRequestText } from "@/lib/amazon-sync/request-body";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { authorizeLili, exchangeLiliToken, registerLiliClient, revokeLiliToken, validateAuthorization } from "@/lib/lili/oauth";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
async function handle(request: Request, context: { params: Promise<{ action: string }> }) {
 try {
  const { action } = await context.params;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) throw new SyncInputError("invalid_request", 403);
  if (action === "authorize" && request.method === "GET") {
    const fields = await validateAuthorization(url.searchParams, request);
    return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>连接 Lili MCP</title><body><h1>连接 Codex 与 Lili</h1><p>请在已登录 ERP 的设置 → AI 与 MCP → Lili MCP 生成一次性配对码。配对只授予该凭证现有权限。</p><p>客户端：' + escape(fields.clientId) + '</p><p>回调：' + escape(fields.redirectUri) + '</p><form method="post"><label>配对 ID <input name="pairingId" required autocomplete="off"></label><br><label>一次性验证密钥 <input type="password" name="pairingCode" required autocomplete="off"></label><br><button type="submit">授权并连接</button></form></body></html>', { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: action === "authorize" ? "GET, POST" : "POST" } });
  if (action === "register") return NextResponse.json(await registerLiliClient(await boundedJsonObject(request, 8192)), { status: 201, headers });
  if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") throw new SyncInputError("invalid_request", 415);
  const form = new URLSearchParams(await boundedRequestText(request, 8192));
  if ([...form.keys()].some(k => form.getAll(k).length !== 1)) throw new SyncInputError("invalid_request", 400);
  if (action === "authorize") {
    if (!origin || origin !== url.origin) throw new SyncInputError("invalid_request", 403);
    const redirect = await authorizeLili(url.searchParams, request, form.get("pairingId") || "", form.get("pairingCode") || "");
    return new Response(null, { status: 303, headers: { ...headers, Location: redirect } });
  }
  if (action === "token") return NextResponse.json(await exchangeLiliToken(form, request), { headers });
  if (action === "revoke") { await revokeLiliToken(form); return new Response(null, { status: 200, headers }); }
  return NextResponse.json({ error: "not_found" }, { status: 404, headers });
 } catch (e) {
  const status = e instanceof SyncInputError ? e.status : 503;
  return NextResponse.json({ error: e instanceof SyncInputError && ["invalid_client_metadata", "invalid_redirect_uri", "invalid_grant", "unsupported_grant_type", "invalid_request"].includes(e.message) ? e.message : status === 503 ? "temporarily_unavailable" : "invalid_request" }, { status, headers });
 }
}
export const GET = handle;
export const POST = handle;
