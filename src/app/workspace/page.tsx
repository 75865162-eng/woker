import { AppShell } from "@/components/app-shell/app-shell";
import { IdleMount } from "@/components/app-shell/idle-mount";
import { CampaignGridHome, WorkspacePanel } from "@/components/app-shell/lazy-workbenches";

export default function WorkspacePage() {
  return (
    <AppShell title="PPC 优化工作台" subtitle="Campaign 分组、生命周期规则、Overall 匹配和草稿优先执行">
      <div className="space-y-5">
        <div className="min-w-0">
          <CampaignGridHome />
        </div>
        <IdleMount
          fallback={
            <section className="rounded-lg border border-border bg-white">
              <div className="border-b border-border px-5 py-4">
                <div className="h-4 w-32 animate-pulse rounded bg-surface-muted" />
                <div className="mt-2 h-3 w-80 max-w-full animate-pulse rounded bg-surface-muted" />
              </div>
              <div className="space-y-4 p-5">
                <div className="h-12 animate-pulse rounded-lg border border-border bg-surface-muted" />
                <div className="h-36 animate-pulse rounded-lg border border-border bg-surface-muted" />
                <div className="h-80 animate-pulse rounded-lg border border-border bg-surface-muted" />
              </div>
            </section>
          }
        >
          <div className="min-w-0">
            <WorkspacePanel />
          </div>
        </IdleMount>
      </div>
    </AppShell>
  );
}
