import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
export const runtime = "nodejs";
async function retired(request: Request) {
  const permission = await requireApiPermission("operations", "edit", request);
  if (!permission.ok) return permission.response;
  return NextResponse.json({ error: "旧入口已合并至 Amazon 数据处理中心，请先创建审批请求。", code: "AMAZON_ENTRY_RETIRED" }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
export const POST = retired;
