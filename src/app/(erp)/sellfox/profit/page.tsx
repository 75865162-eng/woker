import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell/app-shell";
import { HostWorkbench } from "@/components/sellfox/host/host-workbench";
import { SalesStatsWorkbench } from "../sales/_components/SalesStatsWorkbench";
import { hostPage } from "@/lib/sellfox/host-pages";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ view?: string }> }): Promise<Metadata> {
  const { view } = await searchParams;
  return { title: view === "report" ? "利润报表" : "销量统计" };
}

/**
 * 赛狐「销量统计」承接页（字段级复刻 T01）。
 *
 * - 默认（无 view 参数）：渲染销量统计工作台，与 /sellfox/sales 为同一组件、同一查询，
 *   不维护第二套算法；数据源为 SellfoxSalesDailySnapshot。
 * - ?view=report：保留原有「利润报表」四数据集入口（产品日利润 live + 按日/月/结算 planned），
 *   数据源为 SellfoxProductDailySnapshot，语义独立、不与销量混用。
 *
 * 两个 URL 均可直接打开、刷新、带参数。详见
 * docs/sellfox-profit-sales-replica-implementation-plan.md。
 */
export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;

  if (view === "report") {
    const page = hostPage("profit");
    if (!page) return null;
    return (
      <AppShell title="利润报表" subtitle="产品日利润 / 按日利润 8 维 / 月利润 / 结算利润，三套口径分表存。">
        <HostWorkbench page={page} />
      </AppShell>
    );
  }

  return (
    <AppShell title="销量统计" subtitle="数据 → 销量统计。读取本地 SellfoxSalesDailySnapshot。">
      <SalesStatsWorkbench />
    </AppShell>
  );
}
