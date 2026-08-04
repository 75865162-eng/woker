import { AppShell } from "@/components/app-shell/app-shell";
import { SettingsWorkbench } from "@/components/settings/settings-workbench";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function SettingsPage() {
  return (
    <AppShell title="系统设置" subtitle="AI 大模型、系统安全边界与导出映射">
      <div className="space-y-5">
        <DataSourceBanner
          tone="mixed"
          title="系统连接走后端测试，本地仍保存个人配置"
          description="AI 连通性测试由服务端 API 代理请求；模型参数、企微通知等设置仍保存在当前浏览器，后续多人使用时需要迁入组织级配置。"
        />
        <SettingsWorkbench />
      </div>
    </AppShell>
  );
}
