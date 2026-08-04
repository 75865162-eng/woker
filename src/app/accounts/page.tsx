import { AppShell } from "@/components/app-shell/app-shell";
import { AccountWorkbench } from "@/components/accounts/account-workbench";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function AccountsPage() {
  return (
    <AppShell title="账号权限" subtitle="同事账号、密码与角色权限管理">
      <div className="space-y-5">
        <DataSourceBanner
          tone="database"
          title="账号和团队成员已接入数据库"
          description="用户、组织、成员、会话和审计记录由后端模型承载；页面仍保留本地缓存作为兼容降级，适合继续补齐按钮级权限和操作审计。"
        />
        <AccountWorkbench />
      </div>
    </AppShell>
  );
}
