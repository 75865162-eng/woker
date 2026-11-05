import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess } from "@/lib/amazon-sync/data-access";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
function dateParam(value: string | null, fallback: Date) {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("日期格式无效。");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("日期格式无效。");
  return date;
}

export async function GET(request: Request) {
  const permission = await requireApiPermission("workspace", "view", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers });
  try {
    const url = new URL(request.url), params = url.searchParams;
    const kind = params.get("kind") ?? "entities";
    if (kind !== "entities" && kind !== "reports") return NextResponse.json({ error: "Ads 数据类型无效。" }, { status: 400, headers });
    const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(100, Number(params.get("pageSize")) || 50));
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    const access = await amazonDataAccess(scope, permission.user.id);
    const profile = params.get("profileId");
    const profileWhere = { ...(profile ? { id: profile } : {}), ...(access.allSellers ? {} : { sellerAccountId: { in: access.sellerIds } }) };
    if (kind === "entities") {
      const entityType = params.get("entityType");
      const rows = await prisma.amazonAdsEntityRecord.findMany({ where: { ...scope, ...(entityType ? { entityType: entityType.slice(0, 100) } : {}), profile: { ...scope, ...profileWhere } }, orderBy: [{ entityType: "asc" }, { externalId: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
      await auditAmazonDataRead(scope, permission.user.id, "amazon-ads-entities", permission.user.role);
      return NextResponse.json({ rows, page, pageSize }, { headers });
    }
    const today = new Date();
    const to = dateParam(params.get("to"), new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
    const from = dateParam(params.get("from"), new Date(to.getTime() - 29 * 86400_000));
    if (from > to || to.getTime() - from.getTime() > 366 * 86400_000) return NextResponse.json({ error: "报表日期范围最多 367 天。" }, { status: 400, headers });
    const reportType = params.get("reportType");
    const rows = await prisma.amazonAdsReportFact.findMany({ where: { ...scope, ...(reportType ? { reportType: reportType.slice(0, 100) } : {}), reportDate: { gte: from, lte: to }, profile: { ...scope, ...profileWhere } }, orderBy: [{ reportDate: "desc" }, { campaignId: "asc" }, { factKey: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
    await auditAmazonDataRead(scope, permission.user.id, "amazon-ads-report-facts", permission.user.role);
    return NextResponse.json({ rows: rows.map(row => ({ ...row, impressions: row.impressions.toString(), clicks: row.clicks.toString(), spend: row.spend.toString(), orders: row.orders.toString(), sales: row.sales.toString(), units: row.units.toString() })), page, pageSize, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法读取 Amazon Ads 数据。" }, { status: 400, headers });
  }
}
