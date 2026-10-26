import { resolveEffectiveReportDate } from "@/lib/sellfox/browse-report-date";
import { sellfoxWorkbenchExport } from "@/lib/sellfox/workbench-export";
import { readSellfoxAgentRows, sellfoxAgentCsv } from "@/lib/sellfox/agent-read";
import ExcelJS from "exceljs";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { assertSellfoxExportComplete, sellfoxBrowseQuery, sellfoxSnapshotWhere, sellfoxExportLimit, SellfoxBrowseError } from "@/lib/sellfox/browse-query";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
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

  try {
    const scope = workspaceScopeFromRequest(request);
    const url = new URL(request.url);
    let query = sellfoxBrowseQuery(url);
    if (url.searchParams.get("agent") === "1") {
      const { rows } = await readSellfoxAgentRows("performance", query, { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId }, true);
      return new Response(sellfoxAgentCsv("performance", rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="sellfox-profit-agent.csv"', "Cache-Control": "no-store" } });
    }
    const storeIds = await sellfoxBrowseStoreIds(query, permission.user.organizationId, scope.workspaceId);
    if (query.layout || query.fulfillment || query.productTag) return await sellfoxWorkbenchExport("performance", query, { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId }, url);
    query = await resolveEffectiveReportDate("performance", query, { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId });
    const where = sellfoxSnapshotWhere(query, permission.user.organizationId, scope.workspaceId, storeIds, true);
    const dateLabel = url.searchParams.get("from") || url.searchParams.get("to") || (typeof where.reportDate === "string" ? where.reportDate : "history");
    const rows = await prisma.sellfoxProductDailySnapshot.findMany({
      where,
      select: { reportDate: true, sku: true, msku: true, asin: true, title: true, saleQuantity: true, fbaQuantity: true, fbmQuantity: true, saleRevenue: true, grossProfit: true, grossProfitRate: true, adCost: true, refundRate: true, currency: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } },
      orderBy: [{ saleRevenue: "desc" }, { id: "asc" }],
      take: sellfoxExportLimit + 1,
    });

    assertSellfoxExportComplete(rows);

    if (url.searchParams.get("format") === "csv") {
      const headers = ["日期", "店铺", "Shop ID", "站点", "ASIN", "MSKU", "SKU", "标题", "销量", "FBA销量", "FBM销量", "销售额", "毛利润", "毛利率", "广告费", "退款率", "币种"];
      const data = rows.map((row) => [row.reportDate, row.SellfoxStore.name, row.SellfoxStore.externalId, row.SellfoxStore.marketplace, row.asin, row.msku, row.sku, row.title, row.saleQuantity, row.fbaQuantity, row.fbmQuantity, row.saleRevenue, row.grossProfit, row.grossProfitRate, row.adCost, row.refundRate, row.currency]);
      const output = [headers, ...data].map((line) => line.map(csvCell).join(",")).join("\r\n");
      return new Response(`\uFEFF${output}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sellfox-performance-${dateLabel}.csv"`, "Cache-Control": "no-store" } });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("赛狐销售利润");
    sheet.columns = [
      { header: "Shop ID", key: "shopExternalId", width: 22 },
      { header: "币种", key: "currency", width: 12 },
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
      sheet.addRow({ ...row, shopExternalId: row.SellfoxStore.externalId, store: row.SellfoxStore.name || row.SellfoxStore.externalId, marketplace: row.SellfoxStore.marketplace });
    }
    ["saleRevenue", "grossProfit", "adCost"].forEach((key) => (sheet.getColumn(key).numFmt = "#,##0.00"));
    ["grossProfitRate", "refundRate"].forEach((key) => (sheet.getColumn(key).numFmt = "0.00%"));
    sheet.autoFilter = "A1:Q1";
    const output = await workbook.xlsx.writeBuffer();
    return new Response(output, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="sellfox-product-performance-${dateLabel}.xlsx"`,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof SellfoxBrowseError ? error.message : "导出赛狐销售利润失败，请稍后重试。" }, { status: error instanceof SellfoxBrowseError ? error.status : 500 });
  }
}
