import { AppShell } from "@/components/app-shell/app-shell";
import { AccountWorkbench } from "@/components/accounts/account-workbench";
import { getOrganizationRoleCatalogSnapshot } from "@/lib/accounts/role-catalog-server";
import { getCurrentUserFromSignedCookie } from "@/lib/auth/session";
import { getTeamRosterSnapshot } from "@/lib/accounts/team-roster-server";

export default async function AccountsPage() {
  const user = await getCurrentUserFromSignedCookie();

  if (!user) {
    return (
      <AppShell title="账号权限" subtitle="同事账号、密码与角色权限管理">
        <AccountWorkbench />
      </AppShell>
    );
  }

  const [teamRoster, roleCatalog] = await Promise.all([
    getTeamRosterSnapshot(user.organizationId),
    getOrganizationRoleCatalogSnapshot(user.organizationId),
  ]);
  const initialRolePermissions = Object.fromEntries(roleCatalog.roles.map((role) => [role.id, role.permissions]));

  return (
    <AppShell
      title="账号权限"
      subtitle="同事账号、密码与角色权限管理"
      initialRolePermissions={initialRolePermissions}
      initialUser={user}
    >
      <AccountWorkbench initialAccounts={teamRoster.accounts} initialRoles={roleCatalog.roles} />
    </AppShell>
  );
}
