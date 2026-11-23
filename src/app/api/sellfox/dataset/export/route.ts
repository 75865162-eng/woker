import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { sellfoxBrowseQuery, SellfoxBrowseError } from "@/lib/sellfox/browse-query";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
import { hostDataset } from "@/lib/sellfox/host-pages";
import { readHostDataset, type HostQuery } from "@/lib/sellfox/host-read";
import { readSellfoxWorkbench } from "@/lib/sellfox/workbench-read";
import { workspaceScopeFromRequest, WorkspaceScopeError } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const HOST_EXPORT_LIMIT = 10_000;

function paramDate(value: string | null, fallbackOffsetDays: number) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const now = new Date(Date.now() + fallbackOffsetDays * 86_400_000);
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function cell(value: unknown) {
  if (typeof value === "number") return String(value);
  let text = value instanceof Date ? value.toISOString() : value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`; // CSV 注入防护
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

/** 承接页服务端全量导出：与 dataset 读取同筛选/同授权收窄，最多 10,000 行，不做跨币种相加。 */
export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "export", request);
  if (!permission.ok) return permission.response;

  const url = new URL(request.url);
  const id = url.searchParams.get("dataset") ?? "";
  const entry = hostDataset(id);
  if (!entry) return NextResponse.json({ error: "未知的赛狐数据集。" }, { status: 400 });
  const { dataset } = entry;
  if (dataset.status !== "live") {
    return NextResponse.json({ error: `数据集「${dataset.label}」尚未同步，目标表 ${dataset.table}。`, status: "planned" }, { status: 409 });
  }

  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const columnKeys = url.searchParams.getAll("column");

  try {
    const scope = workspaceScopeFromRequest(request);
    const fullScope = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, userId: permission.user.id };
    let rows: Record<string, unknown>[];
    let columns: { key: string; label: string }[];

    if (dataset.endpoint === "/api/sellfox/performance") {
      const query = sellfoxBrowseQuery(url, "performance");
      await sellfoxBrowseStoreIds(query, fullScope.organizationId, fullScope.workspaceId, { id: permission.user.id, role: permission.user.role });
      const result = await readSellfoxWorkbench("performance", { ...query, page: 1, pageSize: HOST_EXPORT_LIMIT }, fullScope, true);
      columns = columnKeys.length ? dataset.columns.filter((column) => columnKeys.includes(column.key)) : dataset.columns;
      rows = result.rows as Record<string, unknown>[];
    } else {
      const query: HostQuery = {
        from: paramDate(url.searchParams.get("from"), 30),
        to: paramDate(url.searchParams.get("to"), 0),
        site: url.searchParams.get("site") ?? "",
        shop: url.searchParams.get("shop") ?? "",
        search: (url.searchParams.get("search") ?? "").slice(0, 120),
        adType: ["sp", "sb", "sd"].includes(url.searchParams.get("adType") ?? "") ? String(url.searchParams.get("adType")) : "",
        page: 1,
        pageSize: HOST_EXPORT_LIMIT,
        sortBy: url.searchParams.get("sortBy") ?? "reportDate",
        sortOrder: url.searchParams.get("sortOrder") === "asc" ? "asc" : "desc",
      };
      const result = await readHostDataset(dataset, fullScope, query);
      const sourceColumns = result.columns ?? dataset.columns;
      columns = columnKeys.length ? sourceColumns.filter((column) => columnKeys.includes(column.key)) : sourceColumns;
      rows = result.rows as Record<string, unknown>[];
    }

    if (rows.length > HOST_EXPORT_LIMIT) {
      return NextResponse.json({ error: `筛选结果超过 ${HOST_EXPORT_LIMIT} 条，请缩小日期或店铺范围后导出；未导出部分文件。` }, { status: 413 });
    }

    if (format === "xlsx") {
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("赛狐承接页导出");
      sheet.columns = columns.map((column) => ({ header: column.label, key: column.key, width: 18 }));
      for (const row of rows) sheet.addRow(Object.fromEntries(columns.map((column) => [column.key, row[column.key] ?? null])));
      return new Response(await book.xlsx.writeBuffer(), {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="sellfox-host-${id}.xlsx"`, "Cache-Control": "no-store" },
      });
    }

    const headers = columns.map((column) => column.label);
    const lines = rows.map((row) => columns.map((column) => row[column.key]));
    return new Response(`\uFEFF${csv(headers, lines)}`, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sellfox-host-${id}.csv"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SellfoxBrowseError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceScopeError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error(JSON.stringify({ scope: "sellfox.dataset.export", dataset: id, message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ error: "导出赛狐数据集失败，请稍后重试。" }, { status: 500 });
  }
}
