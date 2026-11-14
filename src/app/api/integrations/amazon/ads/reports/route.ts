import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { AdsQueryError } from "@/lib/amazon-ads/query-contract";
import { reportAcquisitionOverview, spReportPipelineEnabled, triggerSpReportSync } from "@/lib/amazon-ads/report-service";
import { spReportTypeIds, isSpReportType } from "@/lib/amazon-ads/sp-report-types";
import { prisma } from "@/lib/db/prisma";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

/** SP 五类绩效报表的实盘采集状态。 */
export async function GET(request: Request) {
  const permission = await requireApiPermission("settings", "view", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers });
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    const profileId = new URL(request.url).searchParams.get("profileId")?.trim() || undefined;
    if (profileId && profileId.length > 100) throw new SyncInputError("Profile 筛选参数无效。");
    const overview = await reportAcquisitionOverview(scope, permission.user.id, profileId);
    await auditAmazonDataRead(scope, permission.user.id, "amazon-ads-report-acquisition", permission.user.role);
    return NextResponse.json(overview, { headers });
  } catch (error) {
    if (error instanceof AdsQueryError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof SyncInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return NextResponse.json({ error: "无法读取报表采集状态。" }, { status: 500, headers });
  }
}

/** 手动补齐/重跑五类报表。真实请求仍受云端执行角色与授权闸门约束。 */
export async function POST(request: Request) {
  const permission = await requireApiPermission("settings", "edit", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers });
  try {
    const body = await boundedJsonObject(request, 8 * 1024);
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    if (!spReportPipelineEnabled()) throw new AdsQueryError("ADS_REPORT_PIPELINE_DISABLED", 403);
    const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
    if (!profileId || profileId.length > 100) throw new SyncInputError("请选择 Ads Profile。");
    const action = typeof body.action === "string" ? body.action : "sync";
    if (action === "sync") {
      const from = typeof body.from === "string" ? body.from.trim() : undefined;
      const to = typeof body.to === "string" ? body.to.trim() : undefined;
      const result = await triggerSpReportSync(scope, permission.user.id, { profileRecordId: profileId, from, to });
      return NextResponse.json(result, { headers });
    }
    if (action === "retry") {
      const reportType = body.reportType;
      if (!isSpReportType(reportType)) throw new SyncInputError("报表类型无效。");
      const task = await prisma.amazonAdsSyncTask.findFirst({
        where: { ...scope, trigger: "sp-report", profileId, status: { in: ["BLOCKED", "FAILED", "WAITING_FOR_CONFIG"] } },
        orderBy: [{ createdAt: "desc" }], select: { id: true, dispatchVersion: true },
      });
      if (!task) throw new AdsQueryError("ADS_REPORT_RETRY_TARGET_MISSING", 409);
      await prisma.amazonAdsSyncTask.update({ where: { id: task.id }, data: { status: "WAITING", nextAttemptAt: new Date(), dispatchVersion: { increment: 1 }, fenceVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, errorCode: null, errorMessage: null, finishedAt: null } });
      return NextResponse.json({ retried: task.id, reportTypes: spReportTypeIds }, { headers });
    }
    throw new SyncInputError("未知操作。");
  } catch (error) {
    if (error instanceof AdsQueryError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof SyncInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof Error && /权限|不可访问/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 403, headers });
    return NextResponse.json({ error: "报表同步未完成。" }, { status: 500, headers });
  }
}
