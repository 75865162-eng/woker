import { AppShellClient } from "@/components/app-shell/app-shell-client";
import { cookies } from "next/headers";
import { parseRolePermissionsCookie, rolePermissionsCookieName } from "@/lib/accounts/permissions";
import { getAuthDriver } from "@/lib/auth/constants";
import { getCurrentUserFromSignedCookie } from "@/lib/auth/session";

export async function AppShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const [user, cookieStore] = await Promise.all([getCurrentUserFromSignedCookie(), cookies()]);
  const rolePermissions = parseRolePermissionsCookie(cookieStore.get(rolePermissionsCookieName)?.value);
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
