import { AppShell } from "@/components/app-shell/app-shell";
import { CampaignGridHome } from "@/components/workspace/campaign-grid-home";
import { WorkspacePanel } from "@/components/workspace/workspace-panel";

export default function WorkspacePage() {
  return (
    <AppShell title="Workspace Home" subtitle="Campaign Grid / Lifecycle orchestration / Draft-first execution">
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
