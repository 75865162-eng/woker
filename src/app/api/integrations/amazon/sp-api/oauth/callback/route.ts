import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { finishAmazonOAuth } from "@/lib/amazon-sync/oauth";
import { SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请使用发起授权的账号登录后重新授权。" }, { status: 401, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  try {
    await finishAmazonOAuth(user.id, new URL(request.url).searchParams);
    // Relative destination; never redirect using callback/client-provided URLs.
    return new Response(null, { status: 303, headers: { Location: "/operations?view=connections", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) { return NextResponse.json({ error: e instanceof SyncInputError ? e.message : "Amazon 授权失败。" }, { status: e instanceof SyncInputError ? e.status : 500, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
}
