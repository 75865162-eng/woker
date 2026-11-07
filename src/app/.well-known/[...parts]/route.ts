import { NextResponse } from "next/server";
import { liliOAuthMetadata, liliOAuthOrigin } from "@/lib/lili/oauth";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ parts: string[] }> }) {
 const key = (await context.params).parts.join("/");
 const headers = { "Cache-Control": "no-store" };
 try {
  if (key === "oauth-authorization-server") return NextResponse.json(liliOAuthMetadata(request), { headers });
  if (["oauth-protected-resource", "oauth-protected-resource/api/lili/mcp"].includes(key)) {
   const origin = liliOAuthOrigin(request);
   return NextResponse.json({ resource: origin + "/api/lili/mcp", authorization_servers: [origin], bearer_methods_supported: ["header"], scopes_supported: ["lili"] }, { headers });
  }
  return new Response(null, { status: 404, headers });
 } catch { return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503, headers }); }
}
