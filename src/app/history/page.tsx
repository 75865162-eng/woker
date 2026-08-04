import { AppShell } from "@/components/app-shell/app-shell";
import { SaihuSearchMergeHistory } from "@/components/app-shell/lazy-workbenches";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function HistoryPage() {
  return (
    <AppShell title="历史记录" subtitle="赛狐搜索词合并数据的本地上传和导出记录">
      <div className="space-y-5">
        <DataSourceBanner
          tone="local"
          title="当前历史记录仍来自浏览器本地"
          description="这里展示的是当前设备保存的搜索词合并历史，不是数据库中的组织级历史；迁移后应按组织、上传人、文件和导出结果查询。"
        />
        <SaihuSearchMergeHistory />
      </div>
    </AppShell>
  );
}
