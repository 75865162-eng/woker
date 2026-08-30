import { AppShellClient } from "@/components/app-shell/app-shell-client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccessiblePathOrFallback } from "@/lib/accounts/permissions";
import { getCurrentUserFromSignedCookie } from "@/lib/auth/session";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";

export async function AppShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const userPromise = getCurrentUserFromSignedCookie();
  const [user, headerStore] = await Promise.all([userPromise, headers()]);
  const rolePermissionsSnapshot = user?.organizationId ? await getOrganizationRolePermissionsSnapshot(user.organizationId) : null;

  const currentPath = headerStore.get("x-current-path");
  const rolePermissions = rolePermissionsSnapshot?.permissions ?? null;
  const initials = user?.name
    ? user.name.slice(0, 2).toUpperCase()
    : user?.email
      ? user.email.slice(0, 2).toUpperCase()
      : "AM";

  if (!user) {
    redirect("/login");
  }

  if (currentPath) {
    const accessiblePath = getAccessiblePathOrFallback(currentPath, user?.role, rolePermissions);
    if (accessiblePath !== currentPath) {
      redirect(accessiblePath);
    }
  }

  return (
    <AppShellClient
      title={title}
      subtitle={subtitle}
      userInitials={initials}
      userName={user?.name}
      userRole={user?.role}
      organizationName={user?.organizationName}
      rolePermissions={rolePermissions}
    >
      {children}
    </AppShellClient>
  );
}
