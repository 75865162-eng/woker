import Link from "next/link";
import { ArrowRight, CheckCircle2, Database, FileSpreadsheet, SlidersHorizontal } from "lucide-react";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const flow = [
  { icon: FileSpreadsheet, title: "导入 Workbook", text: "支持多 Sheet、100,000+ 行、异步解析并保留原始文件" },
  { icon: Database, title: "构建 Campaign Workspace", text: "按 Campaign / Ad Group 建立可恢复的优化工作区" },
  { icon: SlidersHorizontal, title: "生成 Draft", text: "规则引擎先生成可审阅草稿，而不是直接改表" },
  { icon: CheckCircle2, title: "安全 Export", text: "仅将已选择且已校验的变更写回 workbook 副本" },
];

export default function Home() {
  return (
    <AppShell title="Amazon PPC Optimization Workspace" subtitle="Campaign-first optimization system for bulk operations">
      <section className="grid min-h-[calc(100vh-112px)] grid-cols-1 items-center gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-7">
          <div className="inline-flex rounded-full border border-border bg-white px-3 py-1 text-xs font-bold text-brand">
            Version 3.0 · Draft-first · Local-first Repository
          </div>
          <div>
            <h1 className="max-w-3xl text-5xl font-black leading-tight tracking-normal text-foreground">
              把 Amazon Bulk 文件重构成真正可操作的 Campaign Workspace
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
              这个系统不再把 Workbook 当成界面本体，而是把 Campaign、Product Cycle、Rule、Draft 和 Export
              组织成一个连续的优化工作流。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/workspace">
              <Button>
                进入工作区
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/rules">
              <Button variant="secondary">打开规则中心</Button>
            </Link>
          </div>
        </div>
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="border-b border-border bg-surface-muted px-5 py-4">
              <p className="text-sm font-bold text-foreground">商业级 PPC 工作流预览</p>
            </div>
            <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
              {flow.map((item) => {
                const Icon = item.icon;

                return (
                  <div key={item.title} className="min-h-[170px] p-6">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="mt-5 text-lg font-bold text-foreground">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted">{item.text}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
