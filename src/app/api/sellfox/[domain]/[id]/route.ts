import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { sellfoxPayloadPreview } from "@/lib/sellfox/payload-preview";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ domain: string; id: string }> }) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  const { domain, id } = await context.params;
  const scope = workspaceScopeFromRequest(request);
  const where = { id, organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
  try {
    let record: { payload: unknown } | { summary: unknown } | null;
    if (domain === "stores") record = await prisma.sellfoxStore.findFirst({ where, select: { payload: true } });
    else if (domain === "inventory") record = await prisma.sellfoxFbaInventorySnapshot.findFirst({ where, select: { payload: true } });
    else if (domain === "sales") record = await prisma.sellfoxSalesDailySnapshot.findFirst({ where, select: { payload: true } });
    else if (domain === "performance") record = await prisma.sellfoxProductDailySnapshot.findFirst({ where, select: { payload: true } });
    else if (domain === "listings") record = await prisma.sellfoxListingSnapshot.findFirst({ where, select: { payload: true } });
    else if (domain === "ads_report") record = await prisma.sellfoxAdsProductDaily.findFirst({ where, select: { payload: true } });
    else if (domain === "hourly") record = await prisma.sellfoxHourlyMetric.findFirst({ where, select: { payload: true } });
    else if (domain === "runs") record = await prisma.sellfoxSyncRun.findFirst({ where, select: { summary: true } });
    else return Response.json({ error: "数据域不存在。" }, { status: 404 });
    if (!record) return Response.json({ error: "记录不存在或不属于当前工作区。" }, { status: 404 });
    return Response.json(sellfoxPayloadPreview("payload" in record ? record.payload : record.summary), { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "读取记录详情失败，请稍后重试。" }, { status: 500 }); }
}
