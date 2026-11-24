import { AppShell } from "@/components/app-shell/app-shell";
import { BuyBoxTrendWorkbench } from "@/components/operations/buybox-trend-workbench";

export const metadata = { title: "BuyBox 与流量趋势 · 亚马逊数据" };

/**
 * /amazon/buybox-trend：迁移自 Wimoor AmzProductPageviewsController。
 * 纯 Amazon BUY_BOX_DAY 观察，与赛狐隔离；按 ASIN 自然周/月上卷 BuyBox 占比 + Sessions + PageViews。
 */
export default function BuyBoxTrendPage() {
  return (
    <AppShell title="BuyBox 与流量趋势" subtitle="按 ASIN 自然周 / 月上卷 · BuyBox 占比均值 · Sessions / PageViews 求和 · 覆盖天数">
      <BuyBoxTrendWorkbench />
    </AppShell>
  );
}
