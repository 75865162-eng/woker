import { AppShell } from "@/components/app-shell/app-shell";
import { SalesStatsWorkbench } from "./_components/SalesStatsWorkbench";

export const metadata = { title: "销量统计" };

export default function SalesStatsPage() {
  return (
    <AppShell title="销量统计" subtitle="数据 → 销量统计。读取本地 SellfoxSalesDailySnapshot。">
      <SalesStatsWorkbench />
    </AppShell>
  );
}
