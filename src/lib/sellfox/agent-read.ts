import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxBrowseQuery, SellfoxBrowseError, sellfoxExportLimit } from "./browse-query";
import { sellfoxDateAt } from "./sync-contract";
export const sellfoxAgentColumns = {
  "inventory": [
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "sourceKey",
    "reportDate",
    "capturedAt",
    "asin",
    "msku",
    "sku",
    "fnsku",
    "quantity",
    "totalInventory",
    "inTransit",
    "inboundWorking",
    "inboundShipped",
    "inboundReceiving",
    "reservedTransfer",
    "reservedProcessing",
    "reservedCustomerorders",
    "unfulfillable",
    "warehouseName",
    "commodityName",
    "currency",
    "avgInventoryCost",
    "avgTransportCost",
    "shopExternalId",
    "name",
    "marketplace"
  ],
  "listings": [
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "sourceKey",
    "capturedAt",
    "asin",
    "msku",
    "sku",
    "parentAsin",
    "title",
    "status",
    "price",
    "currency",
    "fulfillable",
    "sales7",
    "sales14",
    "sales30",
    "revenue7",
    "revenue14",
    "revenue30",
    "adSpend7",
    "adSpend14",
    "adSpend30",
    "sourceUpdatedAt",
    "shopExternalId",
    "name",
    "marketplace",
    "fnsku",
    "parentSku",
    "mainImage"
  ],
  "sales": [
    "complete",
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "sourceKey",
    "reportDate",
    "asin",
    "msku",
    "sku",
    "quantity",
    "revenue",
    "currency",
    "syncedAt",
    "shopExternalId",
    "name",
    "marketplace",
    "orders"
  ],
  "performance": [
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "sourceKey",
    "reportDate",
    "asin",
    "msku",
    "sku",
    "title",
    "currency",
    "saleQuantity",
    "saleRevenue",
    "grossProfit",
    "grossProfitRate",
    "adCost",
    "refundRate",
    "orderNum",
    "netRevenue",
    "syncedAt",
    "shopExternalId",
    "name",
    "marketplace",
    "onlySettle"
  ],
  "ads_report": [
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "reportDate",
    "adType",
    "campaignId",
    "adGroupId",
    "productId",
    "asin",
    "msku",
    "currency",
    "impressions",
    "clicks",
    "cost",
    "adOrders",
    "adSales",
    "syncedAt",
    "shopExternalId",
    "name",
    "marketplace",
    "acos",
    "roas"
  ]
} as const;
export type AgentDomain = keyof typeof sellfoxAgentColumns;
const views: Record<AgentDomain, string> = { inventory: "sellfox_inventory_current", listings: "sellfox_listing_current", sales: "sellfox_sales_daily", performance: "sellfox_profit_daily", ads_report: "sellfox_ads_product_daily" };
export function isSellfoxAgentDomain(domain: string): domain is AgentDomain { return Object.prototype.hasOwnProperty.call(views, domain); }
export async function readSellfoxAgentRows(domain: AgentDomain, query: ReturnType<typeof sellfoxBrowseQuery>, scope: { organizationId: string; workspaceId: string }, exporting = false) {
  const clauses = [Prisma.sql`"organizationId"=${scope.organizationId}`, Prisma.sql`"workspaceId"=${scope.workspaceId}`];
  if (query.shopExternalIds.length) clauses.push(Prisma.sql`"shopExternalId" IN (${Prisma.join(query.shopExternalIds)})`);
  if (domain === "listings" && query.status) clauses.push(Prisma.sql`status ILIKE ${query.status}`);
  if (domain === "performance") clauses.push(Prisma.sql`"onlySettle"=${query.onlySettle}`);
  if (query.storeId) clauses.push(Prisma.sql`"storeId"=${query.storeId}`);
  if (query.site) clauses.push(Prisma.sql`marketplace=${query.site}`);
  if (query.search) {
    const fields = domain === "ads_report" ? ["asin", "msku", "campaignId", "adGroupId", "productId", "name"] : ["asin", "msku", "sku", "name"];
    clauses.push(Prisma.sql`(${Prisma.join(fields.map((key) => Prisma.sql`${Prisma.raw(`"${key}"`)} ILIKE ${`%${query.search}%`}`), " OR ")})`);
  }
  if (domain !== "listings" && domain !== "inventory") {
    if (query.from) clauses.push(Prisma.sql`"reportDate">=${query.from}`);
    if (query.to) clauses.push(Prisma.sql`"reportDate"<=${query.to}`);
    if (!query.from && !query.to && !query.allDates) clauses.push(Prisma.sql`"reportDate"=${query.reportDate ?? sellfoxDateAt(new Date(), -1)}`);
  }
  const source = Prisma.raw(views[domain]); // closed constant map, never request text
  const columns = Prisma.join(sellfoxAgentColumns[domain].map((key) => Prisma.raw(`"${key}"`)));
  const where = Prisma.join(clauses, " AND ");
  const order = Prisma.raw(domain === "inventory" || domain === "listings" ? '"capturedAt" DESC, id' : '"reportDate" DESC, id');
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT ${columns} FROM ${source} WHERE ${where} ORDER BY ${order} LIMIT ${exporting ? sellfoxExportLimit + 1 : query.pageSize} OFFSET ${exporting ? 0 : (query.page - 1) * query.pageSize}`);
  if (exporting && rows.length > sellfoxExportLimit) throw new SellfoxBrowseError("导出超过 10,000 条，请缩小日期或店铺范围并分段。", 413);
  const counts = exporting ? [{ total: rows.length }] : await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::integer AS total FROM ${source} WHERE ${where}`);
  return { rows, pagination: { page: query.page, pageSize: query.pageSize, total: counts[0].total } };
}
export function sellfoxAgentCsv(domain: AgentDomain, rows: Record<string, unknown>[]) {
  const cell = (value: unknown) => {
    if (typeof value === "number") return String(value);
    let text = value instanceof Date ? value.toISOString() : value == null ? "" : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const columns = sellfoxAgentColumns[domain];
  return "\uFEFF" + [columns, ...rows.map((row) => columns.map((key) => row[key]))].map((line) => line.map(cell).join(",")).join("\r\n");
}
