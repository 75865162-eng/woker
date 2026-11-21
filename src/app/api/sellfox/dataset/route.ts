import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { sellfoxBrowseQuery, SellfoxBrowseError } from "@/lib/sellfox/browse-query";
import { hostDataset } from "@/lib/sellfox/host-pages";
import { readHostDataset, type HostQuery } from "@/lib/sellfox/host-read";
import { readSellfoxWorkbench } from "@/lib/sellfox/workbench-read";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

/** 承接页统一读取入口：只读已落库快照，未接入的数据集直接 409，不返回空表冒充数据。 */
export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;

  const url = new URL(request.url);
  const id = url.searchParams.get("dataset") ?? "";
  const entry = hostDataset(id);
  if (!entry) return NextResponse.json({ error: "未知的赛狐数据集。" }, { status: 400 });
  const { dataset } = entry;
  if (dataset.status !== "live") {
    return NextResponse.json({ error: `数据集「${dataset.label}」尚未同步，目标表 ${dataset.table}。`, status: "planned" }, { status: 409 });
  }

  const scope = workspaceScopeFromRequest(request);
  const fullScope = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, userId: permission.user.id };
  const page = clamp(Number(url.searchParams.get("page")), 1, 10_000, 1);
  const pageSize = clamp(Number(url.searchParams.get("pageSize")), 1, 200, 20);

  try {
    if (dataset.endpoint === "/api/sellfox/performance") {
      const query = sellfoxBrowseQuery(url, "performance");
      // 与 /api/sellfox/performance 保持同一授权收窄：把可见店铺写回 query，
      // 使 workbench SQL 与缓存 key 都继承三态 scope，避免承接页导出绕过店铺授权。
      await sellfoxBrowseStoreIds(query, fullScope.organizationId, fullScope.workspaceId, { id: permission.user.id, role: permission.user.role });
      const result = await readSellfoxWorkbench("performance", query, fullScope);
      // 产品日利润的汇总由 readSellfoxWorkbench 按币种给出：values 的键直接对齐列 key。
      const byCurrency = (result.totals as Record<string, unknown>[]).map((row) => {
        const values: Record<string, number | null> = {};
        for (const [key, value] of Object.entries(row)) {
          if (key === "currency") continue;
          const parsed = typeof value === "number" ? value : Number(value);
          if (Number.isFinite(parsed)) values[key] = parsed;
        }
        return { currency: typeof row.currency === "string" ? row.currency : "", values };
      }).filter((bucket) => Object.values(bucket.values).some((value) => value != null && value !== 0));
      return NextResponse.json({
        rows: result.rows,
        total: result.pagination.total,
        totals: { impressions: null, clicks: null, adOrders: null, byCurrency },
        coverage: { stores: 0, rows: result.pagination.total },
        grain: dataset.grain,
      });
    }

    const query: HostQuery = {
      from: paramDate(url.searchParams.get("from"), 30),
      to: paramDate(url.searchParams.get("to"), 0),
      site: url.searchParams.get("site") ?? "",
      shop: url.searchParams.get("shop") ?? "",
      search: (url.searchParams.get("search") ?? "").slice(0, 120),
      adType: ["sp", "sb", "sd"].includes(url.searchParams.get("adType") ?? "") ? String(url.searchParams.get("adType")) : "",
      page,
      pageSize,
      sortBy: url.searchParams.get("sortBy") ?? "reportDate",
      sortOrder: url.searchParams.get("sortOrder") === "asc" ? "asc" : "desc",
    };
    const result = await readHostDataset(dataset, fullScope, query);
    // 原始行数据集的列由真实 payload 派生，随结果一并回传给前端渲染。
    return NextResponse.json({ ...result, columns: result.columns ?? null });
  } catch (error) {
    if (error instanceof SellfoxBrowseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(JSON.stringify({ scope: "sellfox.dataset", dataset: id, message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ error: "读取赛狐数据集失败，请稍后重试。" }, { status: 500 });
  }
}

function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function paramDate(value: string | null, fallbackOffsetDays: number) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const now = new Date(Date.now() + fallbackOffsetDays * 86_400_000);
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}
