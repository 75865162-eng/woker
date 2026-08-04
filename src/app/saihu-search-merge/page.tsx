import { AppShell } from "@/components/app-shell/app-shell";
import { SaihuSearchMergeWorkbench } from "@/components/saihu-search-merge/saihu-search-merge-workbench";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function SaihuSearchMergePage() {
  return (
    <AppShell title="赛狐搜索词合并" subtitle="按用户搜索词合并广告订单、曝光、点击、花费与效率指标">
      <div className="space-y-5">
        <DataSourceBanner
          tone="local"
          title="搜索词合并结果当前是本地历史"
          description="上传文件和导出记录保存在当前浏览器；数据库文件与任务模型已具备，后续可迁移为按组织共享的导入历史。"
        />
        <SaihuSearchMergeWorkbench />
      </div>
    </AppShell>
  );
}
