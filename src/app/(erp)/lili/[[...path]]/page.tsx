import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { CatalogContent } from "@/components/lili/catalog-content";
import { LiliNavigation } from "@/components/lili/navigation";
import styles from "@/components/lili/lili.module.css";
import { getAuthorizationContext } from "@/lib/auth/authorization-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { liliNavigation, resolveLiliPage } from "@/lib/lili/routes";

export const dynamic = "force-dynamic";
export const metadata = { title: "粒粒 Lili · 运营技能中心" };

export default async function LiliPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const parts = (await params).path ?? [];
  const page = resolveLiliPage(parts);
  if (!page) notFound();
  const authorization = await getAuthorizationContext();
  if (!authorization) redirect("/login?next=%2Flili");
  if (!roleCanPerformAction(authorization.user.role, page.moduleId, "view", authorization.permissions)) {
    redirect("/forbidden?from=%2Flili");
  }
  if (page.kind === "login") redirect("/lili");
  if (page.kind === "team") redirect("/accounts");
  if (page.kind === "settings") redirect("/settings");
  const locale = (await cookies()).get("lili_locale")?.value === "en" ? "en" : "zh";
  const allowedPaths = liliNavigation.filter((item) => {
    const resolved = resolveLiliPage(["v2", item.path]);
    return resolved && roleCanPerformAction(authorization.user.role, resolved.moduleId, "view", authorization.permissions);
  }).map((item) => item.path);
  return <AppShell title={`粒粒 Lili · ${page.title}`} subtitle="技能、工作流与工具目录 · 主系统统一权限">
    <div className={styles.root}>
      <LiliNavigation locale={locale} allowedPaths={allowedPaths} />
      <CatalogContent kind={page.kind} slug={page.slug} locale={locale} quotaScopeKey={`${authorization.user.organizationId}:${authorization.user.id}`} />
    </div>
  </AppShell>;
}
