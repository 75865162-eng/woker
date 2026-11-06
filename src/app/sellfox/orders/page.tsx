import { AppShell } from "@/components/app-shell/app-shell";
import { AllOrdersWorkbench } from "./_components/AllOrdersWorkbench";

export const metadata = { title: "全部订单" };

export default function AllOrdersPage() {
  return (
    <AppShell title="全部订单" subtitle="订单 → 全部订单。尚无赛狐订单表，只显示空态。">
      <AllOrdersWorkbench />
    </AppShell>
  );
}
