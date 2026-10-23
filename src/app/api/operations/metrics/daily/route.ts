import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { parseDailyMetricsFilters } from "@/lib/operations/read-models";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("operations", "view", request);
    if (!permission.ok) return permission.response;
    const filters = parseDailyMetricsFilters(new URL(request.url).searchParams);
    if (!filters) return NextResponse.json({ error: "日期范围无效；最多查询连续 90 天。" }, { status: 400 });
    // Internal agents read this projection only. PPC imports currently have no
    // trustworthy daily SKU/ASIN mapping; upload dates must never become report dates.
    return NextResponse.json({
      rows: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, hasNextPage: false },
      source: "PPC WorkspaceDataset", sourceStatus: "NOT_SYNCED",
      sourceNote: "广告来源为现有 PPC 模块；当前导入数据缺少日粒度 SKU/ASIN 关联，日指标投影尚未接通。",
      emptyReason: "NOT_SYNCED：请在广告工作台查看花费、广告销售额与 ACOS；订单未接通，TACOS 为 null。",
      missingFields: { sales: null, adSpend: null, tacos: null },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "日经营指标读取失败。" }, { status: 500 });
  }
}
