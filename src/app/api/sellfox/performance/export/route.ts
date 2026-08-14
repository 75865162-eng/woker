import ExcelJS from "exceljs";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { performanceQuery } from "@/lib/sellfox/performance-query";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "export");
  if (!permission.ok) return permission.response;
  const scope = workspaceScopeFromRequest(request);
  const url = new URL(request.url);
  const where = performanceQuery(url, permission.user.organizationId, scope.workspaceId);
  const rows = await prisma.sellfoxProductDailySnapshot.findMany({ where, include: { store: { select: { name: true, externalId: true, marketplace: true } } }, orderBy: { saleRevenue: "desc" }, take: 10_000 });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("赛狐产品表现");
  sheet.columns = [
    { header: "日期", key: "reportDate", width: 13 }, { header: "店铺", key: "store", width: 24 }, { header: "站点", key: "marketplace", width: 16 },
    { header: "ASIN", key: "asin", width: 16 }, { header: "MSKU", key: "msku", width: 22 }, { header: "SKU", key: "sku", width: 22 }, { header: "标题", key: "title", width: 40 },
    { header: "销量", key: "saleQuantity", width: 12 }, { header: "FBA销量", key: "fbaQuantity", width: 12 }, { header: "FBM销量", key: "fbmQuantity", width: 12 },
    { header: "销售额", key: "saleRevenue", width: 14 }, { header: "毛利润", key: "grossProfit", width: 14 }, { header: "毛利率", key: "grossProfitRate", width: 12 }, { header: "广告花费", key: "adCost", width: 14 }, { header: "退款率", key: "refundRate", width: 12 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B87" } };
  for (const row of rows) sheet.addRow({ ...row, store: row.store.name || row.store.externalId, marketplace: row.store.marketplace });
  ["saleRevenue", "grossProfit", "adCost"].forEach((key) => sheet.getColumn(key).numFmt = '#,##0.00');
  ["grossProfitRate", "refundRate"].forEach((key) => sheet.getColumn(key).numFmt = '0.00%');
  sheet.autoFilter = "A1:O1";
  const output = await workbook.xlsx.writeBuffer();
  return new Response(output, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="sellfox-product-performance-${where.reportDate}.xlsx"` } });
}
