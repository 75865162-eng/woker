import { AppShell } from "@/components/app-shell/app-shell";
import { OrderDetailWorkbench } from "./_components/OrderDetailWorkbench";

export const metadata = { title: "订单详情" };

/** 赛狐订单详情（批量接口）只读承接页：一单一行，原始响应可展开核对。 */
export default function OrderDetailPage() {
  return (
    <AppShell title="订单详情" subtitle="赛狐订单详情批量接口（/api/order/detailByOrderIds.json）的原始行，一单一行，字段缺失保留 - 不补零。">
      <OrderDetailWorkbench />
    </AppShell>
  );
}
