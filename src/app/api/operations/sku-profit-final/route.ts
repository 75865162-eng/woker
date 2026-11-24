import { NextResponse } from "next/server";
import { requireAmazonReadSession } from "@/lib/auth/amazon-read-session";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { AmazonReadError } from "@/lib/amazon-sync/read-account";
import { readSkuProfitFinal } from "@/lib/amazon-sync/sku-profit-final";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const permission = await requireAmazonReadSession(request);
  if (!permission.ok) return permission.response;
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  try {
    await auditAmazonDataRead(scope, permission.user.id, "amazon/sku-profit-final", permission.user.role);
    const result = await readSkuProfitFinal(scope, new URL(request.url).searchParams, permission.user.id);
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof AmazonReadError) {
      return NextResponse.json({ error: error.message, code: error.businessCode }, { status: error.status, headers });
    }
    console.error("[operations.sku-profit-final]", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json({ error: "最终利润报表暂不可用。" }, { status: 500, headers });
  }
}
