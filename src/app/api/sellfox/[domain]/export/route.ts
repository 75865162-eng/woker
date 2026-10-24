import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
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
  if (!["stores", "inventory", "sales", "performance", "hourly", "runs"].includes(domain)) return new Response("数据域暂不支持导出。", { status: 404 });
  const scope = workspaceScopeFromRequest(request); const url = new URL(request.url);
  const common = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
  const from = url.searchParams.get("from")?.trim(); const to = url.searchParams.get("to")?.trim(); const reportDate = url.searchParams.get("reportDate")?.trim(); const search = url.searchParams.get("search")?.trim();
  const dateFilter = from || to ? { reportDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : reportDate ? { reportDate } : {};
  const productSearch = search ? { OR: ["sku", "msku", "asin"].map((field) => ({ [field]: { contains: search, mode: "insensitive" as const } })) } : {};
  const shopExternalIds = url.searchParams.getAll("shopExternalId").filter(Boolean);
  const storeIds = shopExternalIds.length ? (await prisma.sellfoxStore.findMany({ where: { ...common, externalId: { in: shopExternalIds } }, select: { id: true } })).map((row) => row.id) : undefined;
  if (storeIds && storeIds.length !== shopExternalIds.length) return new Response("店铺不属于当前工作区。", { status: 403 });
  let content: string;
  if (domain === "stores") {
    const rows = await prisma.sellfoxStore.findMany({ where: { ...common, ...(storeIds ? { id: { in: storeIds } } : {}), ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { externalId: { contains: search } }, { marketplace: { contains: search, mode: "insensitive" as const } }] } : {}) }, select: { externalId: true, name: true, marketplace: true, country: true, status: true, lastSyncedAt: true }, orderBy: { name: "asc" }, take: 10_000 });
    content = csv(["Shop ID", "店铺", "站点", "国家", "状态", "最近同步"], rows.map((row) => [row.externalId, row.name, row.marketplace, row.country, row.status, row.lastSyncedAt]));
  } else if (domain === "inventory") {
    const rows = await prisma.sellfoxFbaInventorySnapshot.findMany({ where: { ...common, ...(storeIds ? { storeId: { in: storeIds } } : {}), ...dateFilter, ...productSearch }, select: { reportDate: true, capturedAt: true, sku: true, msku: true, asin: true, fnsku: true, quantity: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: { capturedAt: "desc" }, take: 10_000 });
    content = csv(["日期", "抓取时间", "店铺", "Shop ID", "站点", "ASIN", "MSKU", "SKU", "FNSKU", "数量"], rows.map((row) => [row.reportDate, row.capturedAt, row.SellfoxStore.name, row.SellfoxStore.externalId, row.SellfoxStore.marketplace, row.asin, row.msku, row.sku, row.fnsku, row.quantity]));
  } else if (domain === "sales") {
    const rows = await prisma.sellfoxSalesDailySnapshot.findMany({ where: { ...common, ...(storeIds ? { storeId: { in: storeIds } } : {}), ...dateFilter, ...productSearch }, select: { reportDate: true, sku: true, msku: true, asin: true, quantity: true, revenue: true, currency: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: [{ reportDate: "desc" }, { revenue: "desc" }], take: 10_000 });
    content = csv(["日期", "店铺", "Shop ID", "站点", "ASIN", "MSKU", "SKU", "销量", "销售额", "币种"], rows.map((row) => [row.reportDate, row.SellfoxStore.name, row.SellfoxStore.externalId, row.SellfoxStore.marketplace, row.asin, row.msku, row.sku, row.quantity, row.revenue, row.currency]));
  } else if (domain === "hourly") {
    const rows = await prisma.sellfoxHourlyMetric.findMany({ where: { ...common, ...(storeIds ? { storeId: { in: storeIds } } : {}), ...dateFilter }, select: { reportDate: true, hour: true, adType: true, entityName: true, impressions: true, clicks: true, cost: true, sales: true, orders: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: [{ reportDate: "desc" }, { hour: "desc" }], take: 10_000 });
    content = csv(["日期", "小时", "店铺", "Shop ID", "站点", "广告类型", "活动", "曝光", "点击", "花费", "销售额", "订单"], rows.map((row) => [row.reportDate, row.hour, row.SellfoxStore.name, row.SellfoxStore.externalId, row.SellfoxStore.marketplace, row.adType, row.entityName, row.impressions, row.clicks, row.cost, row.sales, row.orders]));
  } else if (domain === "performance") {
    const where: Record<string, unknown> = { ...common, ...(storeIds ? { storeId: { in: storeIds } } : {}), ...dateFilter, ...(search ? { OR: ["sku", "msku", "asin", "title"].map((field) => ({ [field]: { contains: search, mode: "insensitive" } })) } : {}) };
    const rows = await prisma.sellfoxProductDailySnapshot.findMany({ where, select: { reportDate: true, sku: true, msku: true, asin: true, title: true, saleQuantity: true, saleRevenue: true, grossProfit: true, adCost: true, currency: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: { reportDate: "desc" }, take: 10_000 });
    content = csv(["日期", "店铺", "Shop ID", "站点", "ASIN", "MSKU", "SKU", "标题", "销量", "销售额", "毛利润", "广告费", "币种"], rows.map((row) => [row.reportDate, row.SellfoxStore.name, row.SellfoxStore.externalId, row.SellfoxStore.marketplace, row.asin, row.msku, row.sku, row.title, row.saleQuantity, row.saleRevenue, row.grossProfit, row.adCost, row.currency]));
  } else {
    const rows = await prisma.sellfoxSyncRun.findMany({ where: common, select: { resource: true, status: true, summary: true, error: true, startedAt: true, finishedAt: true }, orderBy: { startedAt: "desc" }, take: 10_000 });
    content = csv(["资源", "状态", "摘要", "错误", "开始时间", "结束时间"], rows.map((row) => [row.resource, row.status, JSON.stringify(row.summary), row.error, row.startedAt, row.finishedAt]));
  }
  return new Response(`\uFEFF${content}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sellfox-${domain}.csv"`, "Cache-Control": "no-store" } });
}
