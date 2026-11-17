import { SellfoxHealthPanel } from "@/components/settings/sellfox-health-panel";
import { AppShell } from "@/components/app-shell/app-shell";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SettingsWorkbench } from "@/components/app-shell/lazy-workbenches";
import { SystemDataStatusPanel } from "@/components/settings/system-data-status-panel";
import { WorkerHealthPanel } from "@/components/settings/worker-health-panel";
import { WorkspaceScopePanel } from "@/components/settings/workspace-scope-panel";
import { WeComNotificationSettingsPanel } from "@/components/settings/wecom-notification-settings";
import { AmazonSpApiSettingsPanel } from "@/components/settings/amazon-sp-api-settings-panel";
import { SellfoxCredentialsPanel } from "@/components/settings/sellfox-credentials-panel";
import { SkillErpSettingsPanel } from "@/components/settings/skill-erp-settings-panel";
import Link from "next/link";
import { Suspense } from "react";
import { ConsolePageTemplate } from "@/components/templates/page-templates";

function RelocatedPanel({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted">{description}</p>
      <Link className="mt-4 inline-flex rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white" href={href}>
        前往统一管理中心
      </Link>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AppShell title="系统设置" subtitle="模型、工作区与通知">
      <SettingsTabs
        modelContent={<SettingsWorkbench />}
        workspaceContent={<WorkspaceScopePanel />}
        notificationContent={<WeComNotificationSettingsPanel />}
        pointsContent={<RelocatedPanel title="积分额度与定价已迁移" description="成员积分、额度策略、审批与定价已整合进统一管理中心，请在账号管理中心的「积分额度与定价」页签继续使用。" href="/accounts?tab=points" />}
        integrationsContent={<div className="space-y-[var(--gap-section)]"><AmazonSpApiSettingsPanel /><SellfoxCredentialsPanel /></div>}
        mcpContent={<RelocatedPanel title="MCP 与设备凭证已迁移" description="MCP 凭证、隔离检查与 Lili 设备配对已整合进统一管理中心，请在账号管理中心的「MCP 与设备凭证」页签继续使用。" href="/accounts?tab=mcp" />}
        skillErpContent={<SkillErpSettingsPanel />}
        operationsContent={
          <ConsolePageTemplate
            health={
              <Suspense fallback={<div className="h-16 animate-pulse rounded-md border border-border bg-surface" />}>
                <SystemDataStatusPanel />
              </Suspense>
            }
            tasks={<WorkerHealthPanel />}
            logs={<SellfoxHealthPanel />}
          />
        }
      />
    </AppShell>
  );
}
