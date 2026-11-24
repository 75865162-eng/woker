import { AppShell } from "@/components/app-shell/app-shell";
import { ReturnAnalyticsWorkbench } from "@/components/operations/return-analytics-workbench";

export const metadata = { title: "退货率与质量归因 · 亚马逊数据" };

/**
 * /amazon/return-analytics：迁移自 Wimoor OrdersReturnController。
 * 纯 Amazon Returns 报告 + 同期订单销量，与赛狐隔离；退货率/质量分列、不造数不折算。
 */
export default function ReturnAnalyticsPage() {
  return (
    <AppShell title="退货率与质量归因" subtitle="退货件数 / 同期销量 / 退货率 + sellable·defective·unsellable 质量分列 · 单份已发布退货报告">
      <ReturnAnalyticsWorkbench />
    </AppShell>
  );
}
