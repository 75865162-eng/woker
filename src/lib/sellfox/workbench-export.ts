import { visibleColumns, visibleColumnCsv, sellfoxColumnValue } from "@/components/sellfox/workbench-types";
import { readSellfoxWorkbench, type WorkbenchDomain } from "./workbench-read";
import type { SellfoxBrowseQuery } from "./browse-query";
export async function sellfoxWorkbenchExport(domain: WorkbenchDomain, query: SellfoxBrowseQuery, scope: { organizationId: string; workspaceId: string }, url: URL) {
  const { rows, dates } = await readSellfoxWorkbench(domain, query, scope, true);
  const config = visibleColumns(domain === "ads_report" ? "ads" : domain, (url.searchParams.has("column") || url.searchParams.get("columns") === "custom") ? url.searchParams.getAll("column") : undefined, dates, query.dimension);
  if (url.searchParams.get("format") === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("赛狐本地报表");
    sheet.columns = config.map(c => ({ header: c.labelZh, key: c.key, width: 18 }));
    for (const row of rows) sheet.addRow(Object.fromEntries(config.map(c => [c.key, sellfoxColumnValue(c, row) ?? null])));
    return new Response(await book.xlsx.writeBuffer(), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="sellfox-${domain}.xlsx"`, "Cache-Control": "no-store" } });
  }
  return new Response(visibleColumnCsv(config, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sellfox-${domain}.csv"`, "Cache-Control": "no-store" } });
}
