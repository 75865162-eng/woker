import Link from "next/link";
import { AppShell } from "@/components/app-shell/app-shell";
import { navigationModules } from "@/components/app-shell/business-navigation";

export const dynamic = "force-dynamic";

const shortcuts = [
  { keys: "Ctrl / ⌘ + K", action: "聚焦侧栏菜单搜索（侧栏展开时）" },
  { keys: "Esc", action: "清空菜单搜索 / 关闭收起态浮层菜单" },
  { keys: "Enter", action: "菜单搜索结果中直接打开第一项" },
  { keys: "点击一级模块", action: "展开或收起该模块的二级功能" },
  { keys: "侧栏底部按钮", action: "全局收起（64px）/ 展开（220px）侧栏" },
];

export default function HelpPage() {
  const totalItems = navigationModules.reduce((sum, module) => sum + module.items.length, 0);

  return (
    <AppShell title="帮助中心" subtitle="模块索引 · 二级功能直达 · 快捷键">
      <div className="space-y-4">
        <section className="rounded-lg border border-border bg-white px-5 py-4">
          <h1 className="text-[15px] font-bold text-foreground">导航结构说明</h1>
          <p className="mt-1 text-[13px] leading-6 text-muted">
            左侧导航采用「一级模块 + 二级功能菜单」两层结构，共 {navigationModules.length} 个一级模块、{totalItems} 个功能入口。
            进入页面时对应模块会自动展开并高亮当前功能；收起状态与展开的模块会被记住，刷新浏览器后保持。
            多标签页、iframe 保活与页面缓存机制完全不受影响。
          </p>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {navigationModules.map((module) => {
            const Icon = module.icon;
            return (
              <div key={module.id} className="rounded-lg border border-border bg-white p-4">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-brand">
                    <Icon aria-hidden className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[13px] font-semibold text-foreground">{module.label}</h2>
                    <p className="mt-0.5 text-[11px] leading-5 text-muted">{module.hint}</p>
                  </div>
                </div>
                <ul className="mt-2.5 space-y-px border-t border-border pt-2">
                  {module.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={item.hint ?? item.label}
                        className="flex h-8 items-center justify-between gap-2 rounded px-1.5 text-[13px] text-foreground/80 transition-colors hover:bg-surface-muted hover:text-brand"
                      >
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0 text-[10px] text-muted">{item.href}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>

        <section className="rounded-lg border border-border bg-white p-4">
          <h2 className="text-[13px] font-semibold text-foreground">快捷键与交互</h2>
          <table className="mt-2 w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] text-muted">
                <th className="w-[42%] py-1.5 font-medium">操作</th>
                <th className="py-1.5 font-medium">效果</th>
              </tr>
            </thead>
            <tbody>
              {shortcuts.map((row) => (
                <tr key={row.keys} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 font-mono text-[12px] text-foreground">{row.keys}</td>
                  <td className="py-1.5 text-muted">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </AppShell>
  );
}
