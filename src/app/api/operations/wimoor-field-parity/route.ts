import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import {
  ALL_FIELD_MAPPINGS,
  FIELD_GROUPS,
  STATE_LABELS,
  coverageSummary,
  prioritySummary,
  implementedRatio,
} from "@/lib/amazon-sync/wimoor-field-catalog";
import {
  ADS_METRIC_BASIS,
  PROFIT_METRIC_BASIS,
  TRAFFIC_RATE_BASIS,
} from "@/lib/amazon-sync/wimoor-derived-metrics";
import { FIELD_EXTRACT_GROUPS } from "@/lib/amazon-sync/wimoor-field-extract";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

/**
 * Wimoor 字段对标只读 API。
 * 暴露静态字段目录、五态覆盖汇总、派生公式口径（Wimoor 源码实证）、可提取字段规格。
 * 不读取/返回任何业务数据，只提供「差距可见性」——符合不臆造、不越权红线。
 */
export async function GET(request: Request) {
  const auth = await requireApiPermission("operations", "view", request);
  if (!auth.ok) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const groupFilter = params.get("group")?.trim();
    const stateFilter = params.get("state")?.trim();
    const priorityFilter = params.get("priority")?.trim();

    let fields = ALL_FIELD_MAPPINGS;
    if (groupFilter) fields = fields.filter(f => f.label.length > 0 && FIELD_GROUPS.some(g => g.page === groupFilter && g.fields.includes(f)));
    if (stateFilter) fields = fields.filter(f => f.state === stateFilter);
    if (priorityFilter) fields = fields.filter(f => f.priority === priorityFilter);

    return NextResponse.json({
      groups: FIELD_GROUPS.map(g => ({ page: g.page, pageLabel: g.pageLabel, wimoorRoute: g.wimoorRoute, count: g.fields.length })),
      fields,
      stateLabels: STATE_LABELS,
      summary: {
        coverage: coverageSummary(),
        priority: prioritySummary(),
        implementedRatio: implementedRatio(),
        total: ALL_FIELD_MAPPINGS.length,
      },
      formulaBasis: {
        ads: ADS_METRIC_BASIS,
        profit: PROFIT_METRIC_BASIS,
        traffic: TRAFFIC_RATE_BASIS,
      },
      extractGroups: FIELD_EXTRACT_GROUPS.map(g => ({ domain: g.domain, count: g.specs.length, specs: g.specs })),
      provenance: {
        mappingDoc: "docs/wimoor-sp-api-field-mapping-audit-2026-11-24.md",
        mappingHead: "af8f453a",
        wimoorSnapshot: "ec86736b (2026-09-24 main)",
        derivedFormulas: "Wimoor 源码实证（Mapper.xml / ServiceImpl，见 formulaBasis.source）",
        caveat: "待拍板/待数据项仅提供可见性与激活条件，不生成业务值；取值级一致性需迁移+真实数据后按文档 §6 复核。",
      },
    }, { headers });
  } catch (error) {
    console.error("[operations.wimoor-field-parity]", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json({ error: "字段对标数据暂不可用。" }, { status: 500, headers });
  }
}
