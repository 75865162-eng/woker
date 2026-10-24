import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";
const domains = ["stores", "inventory", "sales", "hourly", "runs"] as const;
type Domain = (typeof domains)[number];
function date(value: string | null) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined; }

export async function GET(request: Request, context: { params: Promise<{ domain: string }> }) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  const { domain } = await context.params;
  if (!domains.includes(domain as Domain)) return NextResponse.json({ error: "数据域不存在。" }, { status: 404 });
  const scope = workspaceScopeFromRequest(request); const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize")) || 50));
  const search = url.searchParams.get("search")?.trim();
  const reportDate = date(url.searchParams.get("reportDate"));
  const from = date(url.searchParams.get("from")); const to = date(url.searchParams.get("to"));
  const storeExternalIds = url.searchParams.getAll("shopExternalId").filter(Boolean);
  const common = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
  const storeIds = storeExternalIds.length ? (await prisma.sellfoxStore.findMany({ where: { ...common, externalId: { in: storeExternalIds } }, select: { id: true } })).map((row) => row.id) : undefined;
  if (domain !== "runs" && storeIds && storeIds.length !== storeExternalIds.length) return NextResponse.json({ error: "店铺不属于当前工作区。" }, { status: 403 });

  if (domain === "stores") {
    const where = { ...common, ...(storeIds ? { id: { in: storeIds } } : {}), ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { externalId: { contains: search } }, { marketplace: { contains: search, mode: "insensitive" as const } }] } : {}) };
    const [total, rows] = await Promise.all([prisma.sellfoxStore.count({ where }), prisma.sellfoxStore.findMany({ where, select: { id: true, externalId: true, name: true, marketplace: true, country: true, status: true, lastSyncedAt: true }, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize })]);
    return NextResponse.json({ rows, pagination: { page, pageSize, total } });
  }
  if (domain === "runs") {
    const [total, rows] = await Promise.all([prisma.sellfoxSyncRun.count({ where: common }), prisma.sellfoxSyncRun.findMany({ where: common, select: { id: true, resource: true, status: true, summary: true, error: true, startedAt: true, finishedAt: true }, orderBy: { startedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })]);
    return NextResponse.json({ rows, pagination: { page, pageSize, total } });
  }
  if (domain === "hourly") {
    const dateRange = from || to ? { reportDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
    const where = { ...common, ...(storeIds ? { storeId: { in: storeIds } } : {}), ...(!from && !to && reportDate ? { reportDate } : {}), ...dateRange };
    const [total, rows] = await Promise.all([prisma.sellfoxHourlyMetric.count({ where }), prisma.sellfoxHourlyMetric.findMany({ where, select: { id: true, reportDate: true, hour: true, adType: true, entityType: true, entityId: true, entityName: true, impressions: true, clicks: true, cost: true, sales: true, orders: true, syncedAt: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: [{ reportDate: "desc" }, { hour: "desc" }], skip: (page - 1) * pageSize, take: pageSize })]);
    return NextResponse.json({ rows, pagination: { page, pageSize, total } });
  }

  const snapshotWhere = { ...common, ...(storeIds ? { storeId: { in: storeIds } } : {}), ...(reportDate ? { reportDate } : {}), ...(from || to ? { reportDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}), ...(search ? { OR: [{ sku: { contains: search, mode: "insensitive" as const } }, { msku: { contains: search, mode: "insensitive" as const } }, { asin: { contains: search, mode: "insensitive" as const } }] } : {}) };
  if (domain === "inventory") {
    const [total, rows] = await Promise.all([prisma.sellfoxFbaInventorySnapshot.count({ where: snapshotWhere }), prisma.sellfoxFbaInventorySnapshot.findMany({ where: snapshotWhere, select: { id: true, reportDate: true, capturedAt: true, sku: true, msku: true, asin: true, fnsku: true, quantity: true, syncedAt: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: [{ capturedAt: "desc" }, { asin: "asc" }], skip: (page - 1) * pageSize, take: pageSize })]);
    return NextResponse.json({ rows, pagination: { page, pageSize, total } });
  }
  const [total, rows] = await Promise.all([prisma.sellfoxSalesDailySnapshot.count({ where: snapshotWhere }), prisma.sellfoxSalesDailySnapshot.findMany({ where: snapshotWhere, select: { id: true, reportDate: true, sku: true, msku: true, asin: true, quantity: true, revenue: true, currency: true, syncedAt: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: [{ reportDate: "desc" }, { revenue: "desc" }], skip: (page - 1) * pageSize, take: pageSize })]);
  return NextResponse.json({ rows, pagination: { page, pageSize, total } });
}
