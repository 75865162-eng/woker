import {
  ArrowRight,
  Bot,
  Boxes,
  ChartNoAxesCombined,
  ClipboardList,
  PackageSearch,
  SearchCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/app-shell";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { PrefetchLink } from "@/components/app-shell/prefetch-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardPageTemplate } from "@/components/templates/page-templates";
import { getModuleIdForPath, roleCanAccessModule } from "@/lib/accounts/permissions";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";
import { getCurrentUser } from "@/lib/auth/session";

const modules = [
  { href: "/workspace", title: "PPC 优化工作台", description: "Bulk 导入、Overall 匹配、规则草稿与导出", icon: UploadCloud },
  { href: "/product", title: "产品管理", description: "商品资料、负责人、流程进度和竞品信息", icon: Boxes },
  { href: "/listing-ai", title: "Listing AI", description: "标题、图片、A+ 和 Listing 优化建议", icon: Sparkles },
  { href: "/agents", title: "Amazon AI Agent Platform", description: "统一 Agent Runtime、Trace、Approval 和 Tool Gateway", icon: Bot },
  { href: "/saihu-search-merge", title: "搜索词合并", description: "合并赛狐搜索词报表并导出汇总", icon: SearchCheck },
  { href: "/logistics", title: "物流处理", description: "装箱表、箱唛 PDF、物流模板和对比表", icon: PackageSearch },
];

// 高频业务对象直达：对标 wimoor「模块名即入口」的一级导航，降低采购单/销量报表等常用对象的点击深度。
const quickAccess = [
  { href: "/product", title: "产品列表", icon: Boxes, moduleId: "products" },
  { href: "/sellfox/profit", title: "销量统计", icon: ChartNoAxesCombined, moduleId: "sellfox" },
  { href: "/sellfox/profit?view=report", title: "利润报表", icon: ChartNoAxesCombined, moduleId: "sellfox" },
  { href: "/purchase/orders", title: "采购订单", icon: ClipboardList, moduleId: "operations" },
];

export default async function Home() {
  const user = await getCurrentUser();
  const rolePermissionsSnapshot = user?.organizationId ? await getOrganizationRolePermissionsSnapshot(user.organizationId) : null;
  const visibleModules = modules.filter((module) =>
    roleCanAccessModule(user?.role, getModuleIdForPath(module.href), rolePermissionsSnapshot?.permissions),
  );

  return (
    <AppShell title="运营工作台" subtitle="Amazon 业务系统总入口">
      <DashboardPageTemplate
        kpis={<DashboardOverview />}
        exceptions={<section className="flex flex-col gap-[var(--gap-field)] rounded-lg border border-border bg-surface p-[var(--pad-card)] shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-display text-foreground">今天要处理什么？</h1>
            <p className="mt-2 text-sm text-muted">选择一个模块开始工作，页面会标明当前数据来源和待迁移边界。</p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-3">
              {visibleModules.some((module) => module.href === "/workspace") ? <PrefetchLink href="/workspace">
                <Button>PPC 优化<ArrowRight className="h-4 w-4" /></Button>
              </PrefetchLink> : null}
              {visibleModules.some((module) => module.href === "/listing-ai") ? <PrefetchLink href="/listing-ai">
                <Button variant="secondary">Listing AI</Button>
              </PrefetchLink> : null}
            </div>
            <nav aria-label="高频业务直达" className="flex flex-wrap items-center gap-2">
              <span className="text-label text-muted">常用：</span>
              {quickAccess
                .filter((item) => roleCanAccessModule(user?.role, item.moduleId, rolePermissionsSnapshot?.permissions))
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <PrefetchLink
                      key={item.href}
                      href={item.href}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-label text-foreground/80 transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <Icon aria-hidden className="h-3.5 w-3.5" />
                      {item.title}
                    </PrefetchLink>
                  );
                })}
            </nav>
          </div>
        </section>}
        shortcuts={<section className="grid gap-[var(--gap-field)] md:grid-cols-2 xl:grid-cols-4">
          {visibleModules.map((module) => {
            const Icon = module.icon;

            return (
              <PrefetchLink key={module.href} href={module.href} className="group block">
                <Card className="h-full transition-colors group-hover:border-brand">
                  <CardContent className="flex min-h-[96px] items-center justify-between gap-4 p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-muted text-brand">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-section text-foreground">{module.title}</h2>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{module.description}</p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-brand" />
                  </CardContent>
                </Card>
              </PrefetchLink>
            );
          })}
        </section>}
      />
    </AppShell>
  );
}
