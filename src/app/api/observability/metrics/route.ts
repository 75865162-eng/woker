import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getMetricsCollector } from "@/lib/observability/metrics-collector";

export const runtime = "nodejs";

/** M0 缓存命中率 / 延迟指标出口（进程内聚合，按 domain）。 */
export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "view", request);
    if (!permission.ok) return permission.response;
    return NextResponse.json(getMetricsCollector().snapshot(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "指标读取失败。" }, { status: 500 });
  }
}
