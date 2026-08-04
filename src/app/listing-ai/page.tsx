import { AppShell } from "@/components/app-shell/app-shell";
import { DataSourceBanner } from "@/components/ui/data-source-banner";
import { ListingAiWorkbench } from "@/components/listing-ai/listing-ai-workbench";

export default function ListingAiPage() {
  return (
    <AppShell title="Listing AI" subtitle="生成 Listing、主图附图、A+ 方案与美工自检清单">
      <div className="space-y-5">
        <DataSourceBanner
          tone="mixed"
          title="AI 配置走系统接口，创作草稿仍在本地"
          description="模型连通性和图片上传接口已具备后端边界；Listing 输入、竞品图、生成历史和图片编排仍保存在当前浏览器，适合下一步绑定 SKU/ASIN 后迁入数据库。"
        />
        <ListingAiWorkbench />
      </div>
    </AppShell>
  );
}
