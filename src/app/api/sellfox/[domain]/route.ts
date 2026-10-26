import { sellfoxPrismaOrder } from "@/lib/sellfox/browse-sort";
import { readSellfoxWorkbench, type WorkbenchDomain } from "@/lib/sellfox/workbench-read";
import { isSellfoxAgentDomain, readSellfoxAgentRows } from "@/lib/sellfox/agent-read";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { sellfoxBrowseQuery, sellfoxStoreWhere, sellfoxSnapshotWhere, sellfoxHourlyWhere, sellfoxRunWhere, SellfoxBrowseError } from "@/lib/sellfox/browse-query";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";
const domains = ["stores", "inventory", "sales", "hourly", "runs", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const;
type Domain = (typeof domains)[number];
export async function GET(request: Request, context: { params: Promise<{ domain: string }> }) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  const { domain } = await context.params;
  if (!domains.includes(domain as Domain)) return NextResponse.json({ error: "数据域不存在。" }, { status: 404 });
  try {
    const scope = workspaceScopeFromRequest(request); const url = new URL(request.url);
    const query = sellfoxBrowseQuery(url, domain); const { page, pageSize } = query;
    const common = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
    const storeIds = domain === "runs" ? undefined : await sellfoxBrowseStoreIds(query, common.organizationId, common.workspaceId);
    if (domain === "sales") return NextResponse.json(await readSellfoxWorkbench("sales", query, common));
    if ((query.layout || query.sortBy || query.productTag || ((query.fulfillment || query.brand || query.buyBox || query.ratingMin != null || query.ratingMax != null || query.ratingCountMin != null || query.ratingCountMax != null || query.costMin != null || query.costMax != null || query.adSalesMin != null || query.adSalesMax != null || query.impressionsMin != null || query.impressionsMax != null) && domain.startsWith("ads_")) || (domain === "listings" && (query.brand || query.buyBox || query.dxmPublishState || query.bsrCategory || query.totalInventoryMin != null || query.totalInventoryMax != null || query.bsrRankMin != null || query.bsrRankMax != null || query.listingQuantityMin != null || query.listingQuantityMax != null || query.reservedQtyMin != null || query.reservedQtyMax != null || query.unsellableMin != null || query.unsellableMax != null || query.warehousingMin != null || query.warehousingMax != null))) && ["listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain)) return NextResponse.json(await readSellfoxWorkbench(domain as WorkbenchDomain, query, common));
    if (isSellfoxAgentDomain(domain) && (domain !== "inventory" || (!query.from && !query.to && !query.allDates))) return NextResponse.json(await readSellfoxAgentRows(domain, query, common));

    if (domain === "stores") {
      const where = sellfoxStoreWhere(query, common.organizationId, common.workspaceId, storeIds);
      const [total, rows] = await Promise.all([prisma.sellfoxStore.count({ where }), prisma.sellfoxStore.findMany({ where, select: { id: true, externalId: true, name: true, marketplace: true, country: true, status: true, lastSyncedAt: true }, orderBy: sellfoxPrismaOrder("stores", query), skip: (page - 1) * pageSize, take: pageSize })]);
      return NextResponse.json({ rows, pagination: { page, pageSize, total } });
    }
    if (domain === "runs") {
      const where = sellfoxRunWhere(query, common.organizationId, common.workspaceId);
      const [total, rows] = await Promise.all([prisma.sellfoxSyncRun.count({ where }), prisma.sellfoxSyncRun.findMany({ where, select: { id: true, resource: true, status: true, summary: true, error: true, startedAt: true, finishedAt: true }, orderBy: sellfoxPrismaOrder("runs", query), skip: (page - 1) * pageSize, take: pageSize })]);
      return NextResponse.json({ rows, pagination: { page, pageSize, total } });
    }
    if (domain === "hourly") {
      const where = sellfoxHourlyWhere(query, common.organizationId, common.workspaceId, storeIds);
      const [total, rows] = await Promise.all([prisma.sellfoxHourlyMetric.count({ where }), prisma.sellfoxHourlyMetric.findMany({ where, select: { id: true, reportDate: true, hour: true, adType: true, entityType: true, entityId: true, entityName: true, impressions: true, clicks: true, cost: true, sales: true, orders: true, syncedAt: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: sellfoxPrismaOrder("hourly", query), skip: (page - 1) * pageSize, take: pageSize })]);
      return NextResponse.json({ rows, pagination: { page, pageSize, total } });
    }

    const snapshotWhere = sellfoxSnapshotWhere(query, common.organizationId, common.workspaceId, storeIds);
    if (domain === "inventory") {
      const [total, rows] = await Promise.all([prisma.sellfoxFbaInventorySnapshot.count({ where: snapshotWhere }), prisma.sellfoxFbaInventorySnapshot.findMany({ where: snapshotWhere, select: { id: true, reportDate: true, capturedAt: true, sku: true, msku: true, asin: true, fnsku: true, quantity: true, totalInventory: true, inTransit: true, inboundWorking: true, inboundShipped: true, inboundReceiving: true, reservedTransfer: true, reservedProcessing: true, reservedCustomerorders: true, unfulfillable: true, warehouseName: true, syncedAt: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: sellfoxPrismaOrder("inventory", query), skip: (page - 1) * pageSize, take: pageSize })]);
      return NextResponse.json({ rows, pagination: { page, pageSize, total } });
    }
    return NextResponse.json({ error: "数据域不存在。" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SellfoxBrowseError ? error.message : "读取赛狐数据失败，请稍后重试。" }, { status: error instanceof SellfoxBrowseError ? error.status : 500 });
  }
}
