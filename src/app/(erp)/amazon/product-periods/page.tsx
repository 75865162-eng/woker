import { AppShell } from "@/components/app-shell/app-shell";
import { ProductPeriodWorkbench } from "@/components/operations/product-period-workbench";

export const metadata = { title: "商品多周期销量宽表 · 亚马逊数据" };

/**
 * /amazon/product-periods：迁移自 Wimoor ProductAnalysisController。
 * 纯 Amazon Sales & Traffic 商品日事实，与赛狐隔离；7/15/30/90 天滚动窗口 + CVR，不折算不补零。
 */
export default function ProductPeriodsPage() {
  return (
    <AppShell title="商品多周期销量宽表" subtitle="按 SKU/ASIN 的 7 / 15 / 30 / 90 天销量 · Sessions · PageViews · CVR · 近 90 天商品日事实">
      <ProductPeriodWorkbench />
    </AppShell>
  );
}
