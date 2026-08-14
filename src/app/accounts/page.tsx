import { AppShell } from "@/components/app-shell/app-shell";
import { AccountWorkbench } from "@/components/app-shell/lazy-workbenches";

export default function AccountsPage() {
  return (
    <AppShell title="账号权限" subtitle="账号、角色和模块权限">
      <div className="space-y-4">
        <AccountWorkbench />
      </div>
    </AppShell>
  );
}
