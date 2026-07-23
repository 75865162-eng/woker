import { AppShell } from "@/components/app-shell/app-shell";
import { SettingsWorkbench } from "@/components/settings/settings-workbench";

export default function SettingsPage() {
  return (
    <AppShell title="Settings" subtitle="AI 大模型、系统安全边界与导出映射">
      <SettingsWorkbench />
    </AppShell>
  );
}
