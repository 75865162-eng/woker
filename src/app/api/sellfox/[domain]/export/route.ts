import { sellfoxPrismaOrder } from "@/lib/sellfox/browse-sort";
import { resolveEffectiveReportDate } from "@/lib/sellfox/browse-report-date";
import { sellfoxWorkbenchExport } from "@/lib/sellfox/workbench-export";
import type { WorkbenchDomain } from "@/lib/sellfox/workbench-read";
import { isSellfoxAgentDomain, readSellfoxAgentRows, sellfoxAgentCsv } from "@/lib/sellfox/agent-read";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { assertSellfoxExportComplete, sellfoxBrowseQuery, sellfoxStoreWhere, sellfoxSnapshotWhere, sellfoxHourlyWhere, sellfoxRunWhere, sellfoxExportLimit, SellfoxBrowseError } from "@/lib/sellfox/browse-query";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";
function cell(value: unknown) {
  if (typeof value === "number") return String(value);
  let text = value instanceof Date ? value.toISOString() : value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

export async function GET(request: Request, context: { params: Promise<{ domain: string }> }) {
  const permission = await requireApiPermission("sellfox", "export", request);
  if (!permission.ok) return permission.response;
  const { domain } = await context.params;
  if (!["stores", "inventory", "sales", "performance", "hourly", "runs", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain)) return new Response("数据域暂不支持导出。", { status: 404 });
  try {
    const scope = workspaceScopeFromRequest(request); const url = new URL(request.url);
    const common = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
    let query = sellfoxBrowseQuery(url, domain);
    const storeIds = domain === "runs" ? undefined : await sellfoxBrowseStoreIds(query, common.organizationId, common.workspaceId);
    if ((query.layout || query.sortBy || ((query.productTag || query.fulfillment || query.brand || query.buyBox || query.ratingMin != null || query.ratingMax != null || query.ratingCountMin != null || query.ratingCountMax != null) && ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain)) || (["sales", "performance", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain) && (url.searchParams.has("column") || url.searchParams.get("columns") === "custom")) || ((query.fulfillment || query.buyBox || query.productTag || query.brand || (domain === "listings" && (query.dxmPublishState || query.totalInventoryMin != null || query.totalInventoryMax != null)) || (domain === "performance" && query.salesperson)) && ["sales", "performance", "listings"].includes(domain))) && url.searchParams.get("agent") !== "1" && ["sales", "performance", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain)) return await sellfoxWorkbenchExport(domain as WorkbenchDomain, query, common, url);
    if (isSellfoxAgentDomain(domain) && (url.searchParams.get("agent") === "1" || domain === "listings" || ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain) || (domain === "inventory" && !query.from && !query.to && !query.allDates))) {
      const { rows } = await readSellfoxAgentRows(domain, query, common, true);
      return new Response(sellfoxAgentCsv(domain, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sellfox-${domain}-agent.csv"`, "Cache-Control": "no-store" } });
    }

    if (domain === "sales") query = await resolveEffectiveReportDate("sales", query, common);
    const snapshotWhere = sellfoxSnapshotWhere(query, common.organizationId, common.workspaceId, storeIds);
    let content: string;
    if (domain === "stores") {
      const rows = await prisma.sellfoxStore.findMany({ where: sellfoxStoreWhere(query, common.organizationId, common.workspaceId, storeIds), select: { externalId: true, name: true, marketplace: true, country: true, status: true, lastSyncedAt: true }, orderBy: sellfoxPrismaOrder("stores", query), take: sellfoxExportLimit + 1 });
      assertSellfoxExportComplete(rows);
      content = csv(["Shop ID", "店铺", "站点", "国家", "状态", "最近同步"], rows.map((row) => [row.externalId, row.name, row.marketplace, row.country, row.status, row.lastSyncedAt]));
    } else if (domain === "inventory") {
      const rows = await prisma.sellfoxFbaInventorySnapshot.findMany({ where: snapshotWhere, select: { reportDate: true, capturedAt: true, sku: true, msku: true, asin: true, fnsku: true, quantity: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: sellfoxPrismaOrder("inventory", query), take: sellfoxExportLimit + 1 });
      assertSellfoxExportComplete(rows);
      content = csv(["日期", "抓取时间", "店铺", "Shop ID", "站点", "ASIN", "MSKU", "SKU", "FNSKU", "可售库存"], rows.map((row) => [row.reportDate, row.capturedAt, row.SellfoxStore.name, row.SellfoxStore.externalId, row.SellfoxStore.marketplace, row.asin, row.msku, row.sku, row.fnsku, row.quantity]));
    } else if (domain === "sales") {
      const rows = await prisma.sellfoxSalesDailySnapshot.findMany({ where: snapshotWhere, select: { reportDate: true, sku: true, msku: true, asin: true, quantity: true, revenue: true, currency: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: [{ reportDate: "desc" }, { revenue: "desc" }, { id: "asc" }], take: sellfoxExportLimit + 1 });
      assertSellfoxExportComplete(rows);
      content = csv(["日期", "店铺", "Shop ID", "站点", "ASIN", "MSKU", "SKU", "销量", "销售额", "币种"], rows.map((row) => [row.reportDate, row.SellfoxStore.name, row.SellfoxStore.externalId, row.SellfoxStore.marketplace, row.asin, row.msku, row.sku, row.quantity, row.revenue, row.currency]));
    } else if (domain === "hourly") {
      const rows = await prisma.sellfoxHourlyMetric.findMany({ where: sellfoxHourlyWhere(query, common.organizationId, common.workspaceId, storeIds), select: { reportDate: true, hour: true, adType: true, entityName: true, impressions: true, clicks: true, cost: true, sales: true, orders: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: sellfoxPrismaOrder("hourly", query), take: sellfoxExportLimit + 1 });
      assertSellfoxExportComplete(rows);
      content = csv(["日期", "小时", "店铺", "Shop ID", "站点", "广告类型", "活动", "曝光", "点击", "花费", "销售额", "订单"], rows.map((row) => [row.reportDate, row.hour, row.SellfoxStore.name, row.SellfoxStore.externalId, row.SellfoxStore.marketplace, row.adType, row.entityName, row.impressions, row.clicks, row.cost, row.sales, row.orders]));
    } else if (domain === "performance") {
      const where = sellfoxSnapshotWhere(query, common.organizationId, common.workspaceId, storeIds, true);
      const rows = await prisma.sellfoxProductDailySnapshot.findMany({ where, select: { reportDate: true, sku: true, msku: true, asin: true, title: true, saleQuantity: true, saleRevenue: true, grossProfit: true, adCost: true, currency: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: { reportDate: "desc" }, take: sellfoxExportLimit + 1 });
      assertSellfoxExportComplete(rows);
      content = csv(["日期", "店铺", "Shop ID", "站点", "ASIN", "MSKU", "SKU", "标题", "销量", "销售额", "毛利润", "广告费", "币种"], rows.map((row) => [row.reportDate, row.SellfoxStore.name, row.SellfoxStore.externalId, row.SellfoxStore.marketplace, row.asin, row.msku, row.sku, row.title, row.saleQuantity, row.saleRevenue, row.grossProfit, row.adCost, row.currency]));
    } else {
      const rows = await prisma.sellfoxSyncRun.findMany({ where: sellfoxRunWhere(query, common.organizationId, common.workspaceId), select: { resource: true, status: true, summary: true, error: true, startedAt: true, finishedAt: true }, orderBy: sellfoxPrismaOrder("runs", query), take: sellfoxExportLimit + 1 });
      assertSellfoxExportComplete(rows);
      content = csv(["资源", "状态", "摘要", "错误", "开始时间", "结束时间"], rows.map((row) => [row.resource, row.status, JSON.stringify(row.summary), row.error, row.startedAt, row.finishedAt]));
    }
    return new Response(`\uFEFF${content}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sellfox-${domain}.csv"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof SellfoxBrowseError ? error.message : "导出赛狐数据失败，请稍后重试。" }, { status: error instanceof SellfoxBrowseError ? error.status : 500 });
  }
}
