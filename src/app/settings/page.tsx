import { Suspense } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { SettingsWorkbench } from "@/components/app-shell/lazy-workbenches";
import { SystemDataStatusPanel } from "@/components/settings/system-data-status-panel";
import { WorkerHealthPanel } from "@/components/settings/worker-health-panel";
import { WorkspaceScopePanel } from "@/components/settings/workspace-scope-panel";

export default function SettingsPage() {
  return (
    <AppShell title="系统设置" subtitle="AI 大模型、系统安全边界与导出映射">
      <div className="space-y-3">
        <Suspense fallback={<SystemStatusFallback />}>
          <SystemDataStatusPanel />
        </Suspense>
        <WorkspaceScopePanel />
        <WorkerHealthPanel />
        <SettingsWorkbench />
      </div>
    </AppShell>
  );
}

function SystemStatusFallback() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,128px)] justify-start gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-md border border-border bg-white shadow-sm" />
      ))}
    </div>
  );
}
