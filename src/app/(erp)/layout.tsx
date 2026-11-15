import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PersistentAppShell } from "@/components/app-shell/persistent-app-shell";
import { PageFrame } from "@/components/erp-page/page-frame";
import { getCurrentUser } from "@/lib/auth/session";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";
import { getCurrentAppVersionLabel } from "@/lib/app-version-server";

/**
 * ERP 总入口。
 * PageFrame 挂在这一层而不是 AppShellClient：wimoor 分支的多标签保活外壳在 iframe 内
 * 只渲染 children（不渲染 AppShellClient），挂这里才能同时覆盖「顶层」与「标签页」两种渲染路径，
 * 让除 /dashboard 外的全部页面与子视图都获得统一布局。
 */
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
  }}>
    <Suspense fallback={<div className="min-h-[40vh] animate-pulse rounded-lg border border-border bg-white" />}>
      <PageFrame>{children}</PageFrame>
    </Suspense>
  </PersistentAppShell>;
}
