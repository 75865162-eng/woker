import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  ImageUp,
  PackageSearch,
  SearchCheck,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

const modules = [
  { href: "/workspace", title: "PPC 优化工作台", description: "Bulk 导入、Overall 匹配、规则草稿与导出", icon: UploadCloud },
  { href: "/dashboard", title: "产品管理", description: "商品资料、负责人、流程进度和竞品信息", icon: Boxes },
  { href: "/rules", title: "规则中心", description: "维护 PPC 生命周期规则，输出可审阅草稿", icon: SlidersHorizontal },
  { href: "/listing-ai", title: "Listing AI", description: "标题、图片、A+ 和 Listing 优化建议", icon: Sparkles },
  { href: "/saihu-search-merge", title: "搜索词合并", description: "合并赛狐搜索词报表并导出汇总", icon: SearchCheck },
  { href: "/image-upscale", title: "图片放大", description: "商品图超分辨率预处理", icon: ImageUp },
  { href: "/logistics", title: "物流处理", description: "装箱表、箱唛 PDF、物流模板和对比表", icon: PackageSearch },
  { href: "/settings", title: "系统设置", description: "AI 模型、通知和系统配置", icon: Settings },
];

export default function Home() {
  return (
    <AppShell title="运营工作台" subtitle="Amazon 业务系统总入口">
      <div className="space-y-5">
        <DataSourceBanner
          tone="mixed"
          title="数据库已接入，当前正在迁移业务数据边界"
          description="账号、权限、文件记录和任务模型已具备后端边界；PPC、商品、Listing AI、物流等工作区会继续保留本地草稿能力，并逐步接入数据库。"
        />

        <section className="flex flex-col gap-4 rounded-lg border border-border bg-white px-6 py-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-black text-foreground">今天要处理什么？</h1>
            <p className="mt-2 text-sm text-muted">选择一个模块开始工作，页面会标明当前数据来源和待迁移边界。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/workspace">
              <Button>
                PPC 优化
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/listing-ai">
              <Button variant="secondary">Listing AI</Button>
            </Link>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {modules.map((module) => {
            const Icon = module.icon;

            return (
              <Link key={module.href} href={module.href} className="group block">
                <Card className="h-full transition-colors group-hover:border-brand">
                  <CardContent className="flex min-h-[96px] items-center justify-between gap-4 p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-muted text-brand">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-foreground">{module.title}</h2>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{module.description}</p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-brand" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}
