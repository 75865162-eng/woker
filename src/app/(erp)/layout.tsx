import { redirect } from "next/navigation";
import { PersistentAppShell } from "@/components/app-shell/persistent-app-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";
import { getCurrentAppVersionLabel } from "@/lib/app-version-server";

export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const snapshot = await getOrganizationRolePermissionsSnapshot(user.organizationId);
  return <PersistentAppShell initialConfiguration={{
    title: "运营工作台", subtitle: "", userId: user.id, organizationId: user.organizationId,
    userName: user.name, userRole: user.role,
    userInitials: (user.name || user.email).slice(0, 2).toUpperCase(),
    rolePermissions: snapshot.permissions,
    authorizationRevision: `${user.organizationId}:${user.id}:${user.role}:${snapshot.revision}`,
    appVersionLabel: getCurrentAppVersionLabel(),
  }}>{children}</PersistentAppShell>;
}
