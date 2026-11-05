import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { controlAdsPlan, runAdsPlanNow } from "@/lib/amazon-ads/sync-service";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess } from "@/lib/amazon-sync/data-access";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  const permission = await requireApiPermission("settings", "view", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers });
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    const access = await amazonDataAccess(scope, permission.user.id);
    const plans = await prisma.amazonAdsSyncPlan.findMany({ where: { ...scope, ...(access.allSellers ? {} : { sellerAccountId: { in: access.sellerIds } }) }, include: { profile: { select: { profileId: true, region: true, countryCode: true, marketplaceId: true, sellerAccountId: true, authorization: { select: { name: true, status: true } } } }, tasks: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, stage: true, trigger: true, attempts: true, processedCount: true, apiRequests: true, errorCode: true, errorMessage: true, requestedFrom: true, requestedTo: true, startedAt: true, finishedAt: true, createdAt: true } } }, orderBy: [{ updatedAt: "desc" }], take: 200 });
    await auditAmazonDataRead(scope, permission.user.id, "amazon-ads-sync-status", permission.user.role);
    return NextResponse.json({ plans }, { headers });
  } catch {
    return NextResponse.json({ error: "无法读取 Amazon Ads 同步状态。" }, { status: 500, headers });
  }
}
export async function POST(request: Request) {
  const permission = await requireApiPermission("settings", "edit", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers });
  try {
    const body = await boundedJsonObject(request, 2048);
    if (!body || typeof body.planId !== "string" || body.planId.length > 100 || !["pause", "resume", "retry", "run"].includes(String(body.action))) return NextResponse.json({ error: "同步计划操作参数无效。" }, { status: 400, headers });
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
    if (body.action === "run") return NextResponse.json(await runAdsPlanNow(scope, permission.user.id, body.planId), { headers, status: 202 });
    const result = await controlAdsPlan(scope, permission.user.id, body.planId, body.action as "pause" | "resume" | "retry");
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法更新 Ads 同步计划。" }, { status: 400, headers });
  }
}
