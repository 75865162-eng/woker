import { AppShell } from "@/components/app-shell/app-shell";
import { CampaignGridHome, WorkspacePanel } from "@/components/app-shell/lazy-workbenches";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function WorkspacePage() {
  return (
    <AppShell title="PPC 优化工作台" subtitle="Campaign 分组、生命周期规则、Overall 匹配和草稿优先执行">
      <div className="space-y-5">
        <DataSourceBanner
          tone="mixed"
          title="PPC 数据已接入可追溯工作区"
          description="Bulk workbook 会先创建 ImportJob，由 Worker 解析为 WorkspaceDataset；规则运行写入 DraftRun，导出写入 ExportRecord 和版本审计。Overall 匹配和现有操作流程保持一致。"
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
