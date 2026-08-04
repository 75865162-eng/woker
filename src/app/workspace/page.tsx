import { AppShell } from "@/components/app-shell/app-shell";
import { DataSourceBanner } from "@/components/ui/data-source-banner";
import { CampaignGridHome } from "@/components/workspace/campaign-grid-home";
import { WorkspacePanel } from "@/components/workspace/workspace-panel";

export default function WorkspacePage() {
  return (
    <AppShell title="PPC 优化工作台" subtitle="Campaign 分组、生命周期规则、Overall 匹配和草稿优先执行">
      <div className="space-y-5">
        <DataSourceBanner
          tone="mixed"
          title="PPC 数据仍以本地工作区为主"
          description="Bulk workbook、Overall 文件、规则运行结果和导出草稿会自动保存到浏览器 IndexedDB；数据库已准备好文件、任务和导出记录边界，后续可迁移为团队共享工作区。"
        />
        <div className="min-w-0">
          <CampaignGridHome />
        </div>
        <div className="min-w-0">
          <WorkspacePanel />
        </div>
      </div>
    </AppShell>
  );
}
