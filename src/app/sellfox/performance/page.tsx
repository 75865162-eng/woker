import { AppShell } from "@/components/app-shell/app-shell";
import { SalesProfitWorkbench } from "./_components/SalesProfitWorkbench";

export const metadata = { title: "销售利润" };

export default function SalesProfitPage() {
  return (
    <AppShell title="销售利润" subtitle="数据 → 销售利润。读取本地 SellfoxProductDailySnapshot。">
      <SalesProfitWorkbench />
    </AppShell>
  );
}
