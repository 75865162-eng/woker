import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { sellfoxBrowseQuery, SellfoxBrowseError } from "@/lib/sellfox/browse-query";
import { hostDataset } from "@/lib/sellfox/host-pages";
import { readHostDataset, type HostQuery } from "@/lib/sellfox/host-read";
import { readSellfoxWorkbench } from "@/lib/sellfox/workbench-read";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { adsSummaryCsv, readAdsEntitySummary } from "@/lib/sellfox/ads-entity-summary";
import type { AdsSummaryMetrics, AdsSummaryQuery } from "@/lib/sellfox/ads-summary-spec";

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
  const exportAll = url.searchParams.get("export") === "1" || url.searchParams.get("format") === "csv";
  const stateParam = url.searchParams.get("state") ?? "";
  if (stateParam && dataset.stateFilter && !["enabled", "paused", "archived"].includes(stateParam)) {
    return NextResponse.json({ error: "state 只能为 enabled / paused / archived。" }, { status: 400 });
  }

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
      searchField: (url.searchParams.get("searchField") ?? "").slice(0, 60),
      exactMatch: url.searchParams.get("exactMatch") === "1",
      adType: ["sp", "sb", "sd"].includes(url.searchParams.get("adType") ?? "") ? String(url.searchParams.get("adType")) : "",
      state: url.searchParams.get("state") ?? "",
      page,
      pageSize,
      sortBy: url.searchParams.get("sortBy") ?? (dataset.summaryKind ? "cost" : "reportDate"),
      sortOrder: url.searchParams.get("sortOrder") === "asc" ? "asc" : "desc",
    };

    // 实体 × 区间汇总：一行一实体、聚合后筛选/排序、分币种合计；导出走同一 SQL，超限直接 413。
    if (dataset.summaryKind) {
      const summaryQuery: AdsSummaryQuery = {
        ...query,
        bucket: url.searchParams.get("bucket") ?? "",
        exportAll,
        ...metricParams(url),
      };
      const result = await readAdsEntitySummary(dataset, fullScope, summaryQuery, dataset.summaryKind);
      if (url.searchParams.get("format") === "csv") {
        const csv = adsSummaryCsv(dataset.columns, result.rows);
        const filename = `${dataset.id}-${query.from}-${query.to}.csv`;
        return new NextResponse(`\uFEFF${csv}`, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      return NextResponse.json({ ...result, columns: result.columns ?? null });
    }

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

const METRIC_KEYS = ["impressions", "clicks", "cost", "adOrders", "adSales", "ctr", "cpc", "acos", "roas"] as const;

/** 区间指标筛选参数：非负有限数、min ≤ max；非法输入返回可读 400，不静默忽略。 */
function metricParams(url: URL): AdsSummaryMetrics {
  const parsed: Record<string, number> = {};
  for (const key of METRIC_KEYS) {
    for (const bound of ["Min", "Max"] as const) {
      const raw = url.searchParams.get(`${key}${bound}`);
      if (raw == null || raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new SellfoxBrowseError(`指标筛选 ${key}${bound} 必须是非负数字。`, 400);
      parsed[`${key}${bound}`] = value;
    }
    const min = parsed[`${key}Min`];
    const max = parsed[`${key}Max`];
    if (min != null && max != null && min > max) throw new SellfoxBrowseError(`指标筛选 ${key} 的最小值不能大于最大值。`, 400);
  }
  return parsed as AdsSummaryMetrics;
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
