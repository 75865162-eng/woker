import { AppShell } from "@/components/app-shell/app-shell";
import { ProductWorkbench } from "@/components/products/product-workbench";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function DashboardPage() {
  return (
    <AppShell title="产品管理" subtitle="商品资料、竞品 ASIN、供应商与尺寸重量的统一工作台">
      <div className="space-y-5">
        <DataSourceBanner
          tone="local"
          title="商品数据当前保存在浏览器本地"
          description="账号和负责人会尝试读取数据库团队成员；商品清单、试算商品、流程编辑和操作日志仍是本地草稿数据，迁移数据库前会继续保持现有使用方式。"
        />
        <ProductWorkbench />
      </div>
    </AppShell>
  );
}
