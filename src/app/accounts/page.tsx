import { AppShell } from "@/components/app-shell/app-shell";
import { AccountWorkbench } from "@/components/accounts/account-workbench";

export default function AccountsPage() {
  return (
    <AppShell title="Accounts" subtitle="同事账号、密码与角色权限管理">
      <AccountWorkbench />
    </AppShell>
  );
}
