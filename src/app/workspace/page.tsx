import { AppShell } from "@/components/app-shell/app-shell";
import { CampaignGridHome, WorkspacePanel } from "@/components/app-shell/lazy-workbenches";

export default function WorkspacePage() {
  return (
    <AppShell title="PPC 优化工作台" subtitle="Campaign 分组、生命周期规则、Overall 匹配和草稿优先执行">
      <div className="space-y-5">
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
