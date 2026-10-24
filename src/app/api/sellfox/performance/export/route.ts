import ExcelJS from "exceljs";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { performanceQuery } from "@/lib/sellfox/performance-query";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function csvCell(value: unknown) {
  if (typeof value === "number") return String(value);
  let text = value instanceof Date ? value.toISOString() : value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "export", request);
  if (!permission.ok) return permission.response;

  const scope = workspaceScopeFromRequest(request);
  const url = new URL(request.url);
  const where = performanceQuery(url, permission.user.organizationId, scope.workspaceId);
  const shopExternalIds = url.searchParams.getAll("shopExternalId").filter(Boolean);
  if (shopExternalIds.length) {
    const stores = await prisma.sellfoxStore.findMany({ where: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, externalId: { in: shopExternalIds } }, select: { id: true } });
    if (stores.length !== shopExternalIds.length) return new Response("店铺不属于当前工作区。", { status: 403 });
    where.storeId = { in: stores.map((store) => store.id) };
  }
  const dateLabel = url.searchParams.get("from") || url.searchParams.get("to") || (typeof where.reportDate === "string" ? where.reportDate : "history");
  const rows = await prisma.sellfoxProductDailySnapshot.findMany({
    where,
    select: { reportDate: true, sku: true, msku: true, asin: true, title: true, saleQuantity: true, fbaQuantity: true, fbmQuantity: true, saleRevenue: true, grossProfit: true, grossProfitRate: true, adCost: true, refundRate: true, currency: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } },
    orderBy: { saleRevenue: "desc" },
    take: 10_000,
  });

  if (url.searchParams.get("format") === "csv") {
    const headers = ["日期", "店铺", "Shop ID", "站点", "ASIN", "MSKU", "SKU", "标题", "销量", "FBA销量", "FBM销量", "销售额", "毛利润", "毛利率", "广告费", "退款率", "币种"];
    const data = rows.map((row) => [row.reportDate, row.SellfoxStore.name, row.SellfoxStore.externalId, row.SellfoxStore.marketplace, row.asin, row.msku, row.sku, row.title, row.saleQuantity, row.fbaQuantity, row.fbmQuantity, row.saleRevenue, row.grossProfit, row.grossProfitRate, row.adCost, row.refundRate, row.currency]);
    const output = [headers, ...data].map((line) => line.map(csvCell).join(",")).join("\r\n");
    return new Response(`\uFEFF${output}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sellfox-performance-${dateLabel}.csv"`, "Cache-Control": "no-store" } });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("赛狐产品表现");
  sheet.columns = [
    { header: "日期", key: "reportDate", width: 13 },
    { header: "店铺", key: "store", width: 24 },
    { header: "站点", key: "marketplace", width: 16 },
    { header: "ASIN", key: "asin", width: 16 },
    { header: "MSKU", key: "msku", width: 22 },
    { header: "SKU", key: "sku", width: 22 },
    { header: "标题", key: "title", width: 40 },
    { header: "销量", key: "saleQuantity", width: 12 },
    { header: "FBA销量", key: "fbaQuantity", width: 12 },
    { header: "FBM销量", key: "fbmQuantity", width: 12 },
    { header: "销售额", key: "saleRevenue", width: 14 },
    { header: "毛利润", key: "grossProfit", width: 14 },
    { header: "毛利率", key: "grossProfitRate", width: 12 },
    { header: "广告花费", key: "adCost", width: 14 },
    { header: "退款率", key: "refundRate", width: 12 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B87" } };
  for (const row of rows) {
    sheet.addRow({ ...row, store: row.SellfoxStore.name || row.SellfoxStore.externalId, marketplace: row.SellfoxStore.marketplace });
  }
  ["saleRevenue", "grossProfit", "adCost"].forEach((key) => (sheet.getColumn(key).numFmt = "#,##0.00"));
  ["grossProfitRate", "refundRate"].forEach((key) => (sheet.getColumn(key).numFmt = "0.00%"));
  sheet.autoFilter = "A1:O1";
  const output = await workbook.xlsx.writeBuffer();
  return new Response(output, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sellfox-product-performance-${dateLabel}.xlsx"`,
    },
  });
}
