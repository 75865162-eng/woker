import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { CatalogContent } from "@/components/lili/catalog-content";
import { LiliNavigation } from "@/components/lili/navigation";
import styles from "@/components/lili/lili.module.css";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { liliNavigation, resolveLiliPage } from "@/lib/lili/routes";

export const dynamic = "force-dynamic";
export const metadata = { title: "粒粒 Lili · 运营技能中心" };

export default async function LiliPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const parts = (await params).path ?? [];
  const page = resolveLiliPage(parts);
  if (!page) notFound();
  const permission = await requireApiPermission(page.moduleId, "view");
  if (!permission.ok) {
    if (permission.response.status === 401) redirect("/login?next=%2Flili");
    redirect("/forbidden?from=%2Flili");
  }
  if (page.kind === "login") redirect("/lili");
  if (page.kind === "team") redirect("/accounts");
  if (page.kind === "settings") redirect("/settings");
  const locale = (await cookies()).get("lili_locale")?.value === "en" ? "en" : "zh";
  const permissions = await getOrganizationRolePermissions(permission.user.organizationId);
  const allowedPaths = liliNavigation.filter((item) => {
    const resolved = resolveLiliPage(["v2", item.path]);
    return resolved && roleCanPerformAction(permission.user.role, resolved.moduleId, "view", permissions);
  }).map((item) => item.path);
  return <AppShell title={`粒粒 Lili · ${page.title}`} subtitle="技能、工作流与工具目录 · 主系统统一权限" initialUser={permission.user} initialRolePermissions={permissions}>
    <div className={styles.root}>
      <LiliNavigation locale={locale} allowedPaths={allowedPaths} />
      <CatalogContent kind={page.kind} slug={page.slug} locale={locale} />
    </div>
  </AppShell>;
}
