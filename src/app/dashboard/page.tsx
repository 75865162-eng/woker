import { AppShell } from "@/components/app-shell/app-shell";
import { ProductWorkbench } from "@/components/app-shell/lazy-workbenches";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function DashboardPage() {
  return (
    <AppShell title="产品管理" subtitle="商品资料、竞品 ASIN、供应商与尺寸重量的统一工作台">
      <div className="space-y-5">
        <DataSourceBanner
          tone="database"
          title="商品清单已切换为数据库优先"
          description="商品列表、Excel 导入结果和商品详情保存到数据库；试算商品和图片文案子草稿后续再按 SKU 继续拆分迁移。"
        />
        <ProductWorkbench />
      </div>
    </AppShell>
  );
}
