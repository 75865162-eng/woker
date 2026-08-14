import { AppShellClient } from "@/components/app-shell/app-shell-client";
import { defaultRolePermissionMap } from "@/lib/accounts/permissions";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { getAuthDriver } from "@/lib/auth/constants";
import { getCurrentUser } from "@/lib/auth/session";

export async function AppShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const user = await getCurrentUser();
  const rolePermissions = user ? await getOrganizationRolePermissions(user.organizationId) : defaultRolePermissionMap;
  const initials = user?.name
    ? user.name.slice(0, 2).toUpperCase()
    : user?.email
      ? user.email.slice(0, 2).toUpperCase()
      : "AM";

  return (
    <AppShellClient
      title={title}
      subtitle={subtitle}
      userInitials={initials}
      userName={user?.name}
      userRole={user?.role}
      organizationName={user?.organizationName}
      rolePermissions={rolePermissions}
      authDriver={getAuthDriver()}
      storageDriver={process.env.STORAGE_DRIVER}
    >
      {children}
    </AppShellClient>
  );
}
