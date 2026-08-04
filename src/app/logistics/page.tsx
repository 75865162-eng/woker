import { AppShell } from "@/components/app-shell/app-shell";
import { LogisticsWorkbench } from "@/components/app-shell/lazy-workbenches";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function LogisticsPage() {
  return (
    <AppShell title="亚马逊物流处理系统（美国站）" subtitle="装箱表、发货模板、包装箱表、箱唛 PDF 和物流模板处理">
      <div className="space-y-5">
        <DataSourceBanner
          tone="mixed"
          title="文件处理仍在当前页面内完成"
          description="数据库已经预留文件、任务和导出记录模型；当前物流解析和导出仍以内存中的上传文件为准，生成结果需要当次下载，后续可迁移为可追溯任务历史。"
        />
        <LogisticsWorkbench />
      </div>
    </AppShell>
  );
}
