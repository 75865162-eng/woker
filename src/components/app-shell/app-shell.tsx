import { AppShellClient } from "@/components/app-shell/app-shell-client";
import { cookies } from "next/headers";
import { parseRolePermissionsCookie, rolePermissionsCookieName } from "@/lib/accounts/permissions";
import { getCurrentUserFromSignedCookie } from "@/lib/auth/session";

export async function AppShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const [user, cookieStore] = await Promise.all([getCurrentUserFromSignedCookie(), cookies()]);
  const rolePermissions = parseRolePermissionsCookie(cookieStore.get(rolePermissionsCookieName)?.value);

  return (
    <AppShellClient title={title} subtitle={subtitle} userRole={user?.role} rolePermissions={rolePermissions}>
      {children}
    </AppShellClient>
  );
}
