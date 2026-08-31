import { AppShell } from "@/components/app-shell/app-shell";
import { AccountWorkbench } from "@/components/app-shell/lazy-workbenches";

export default function AccountsPage() {
  return (
    <AppShell title="账号权限" subtitle="同事账号、密码与角色权限管理">
      <AccountWorkbench />
    </AppShell>
  );
}
