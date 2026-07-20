import { AppShell } from "@/components/app-shell/app-shell";
import { FileJobPanel } from "@/components/files/file-job-panel";
import { CampaignGridHome } from "@/components/workspace/campaign-grid-home";
import { LifecycleBoard } from "@/components/workspace/lifecycle-board";
import { WorkspacePanel } from "@/components/workspace/workspace-panel";

export default function WorkspacePage() {
  return (
    <AppShell title="Workspace Home" subtitle="Campaign Grid銆丩ifecycle orchestration銆丏raft-first execution">
      <div className="space-y-5">
        <FileJobPanel />
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
          <div className="min-w-0">
            <LifecycleBoard />
          </div>
          <div className="min-w-0">
            <CampaignGridHome />
          </div>
        </div>
        <div className="min-w-0">
          <WorkspacePanel />
        </div>
      </div>
    </AppShell>
  );
}
