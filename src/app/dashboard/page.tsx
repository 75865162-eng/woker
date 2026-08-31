import { AppShell } from "@/components/app-shell/app-shell";
import { ProductWorkbench } from "@/components/app-shell/lazy-workbenches";

export default function DashboardPage() {
  return (
    <AppShell title="产品管理" subtitle="商品资料、竞品 ASIN、供应商与尺寸重量的统一工作台">
      <ProductWorkbench />
    </AppShell>
  );
}
