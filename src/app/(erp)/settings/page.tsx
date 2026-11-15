import { SellfoxHealthPanel } from "@/components/settings/sellfox-health-panel";
import { AppShell } from "@/components/app-shell/app-shell";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SettingsWorkbench } from "@/components/app-shell/lazy-workbenches";
import { PointsPolicyPanel } from "@/components/settings/points-policy-panel";
import { SystemDataStatusPanel } from "@/components/settings/system-data-status-panel";
import { WorkerHealthPanel } from "@/components/settings/worker-health-panel";
import { WorkspaceScopePanel } from "@/components/settings/workspace-scope-panel";
import { WeComNotificationSettingsPanel } from "@/components/settings/wecom-notification-settings";
import { AmazonSpApiSettingsPanel } from "@/components/settings/amazon-sp-api-settings-panel";
import { SellfoxCredentialsPanel } from "@/components/settings/sellfox-credentials-panel";
import { SkillErpSettingsPanel } from "@/components/settings/skill-erp-settings-panel";
import { McpSettingsPanel } from "@/components/settings/mcp-settings-panel";
import { Suspense } from "react";

export default function SettingsPage() {
  return (
    <AppShell title="系统设置" subtitle="模型、工作区与通知">
      <SettingsTabs
        modelContent={<SettingsWorkbench />}
        workspaceContent={<WorkspaceScopePanel />}
        notificationContent={<WeComNotificationSettingsPanel />}
        pointsContent={<PointsPolicyPanel />}
        integrationsContent={<div className="space-y-4"><AmazonSpApiSettingsPanel /><SellfoxCredentialsPanel /></div>}
        mcpContent={<McpSettingsPanel />}
        skillErpContent={<SkillErpSettingsPanel />}
        operationsContent={
          <div className="space-y-3">
            <Suspense fallback={<div className="h-16 animate-pulse rounded-md border border-border bg-white" />}>
              <SystemDataStatusPanel />
            </Suspense>
            <WorkerHealthPanel />
            <SellfoxHealthPanel />
          </div>
        }
      />
    </AppShell>
  );
}
