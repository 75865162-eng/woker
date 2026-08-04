import { AppShell } from "@/components/app-shell/app-shell";
import { TaskCenterWorkbench } from "@/components/app-shell/lazy-workbenches";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function TasksPage() {
  return (
    <AppShell title="任务中心" subtitle="导入、解析、导出任务的集中状态视图">
      <div className="space-y-5">
        <DataSourceBanner
          tone="mixed"
          title="任务按当前工作区隔离"
          description="列表读取数据库任务记录；Redis/BullMQ worker 可在系统设置中查看心跳和队列状态。"
        />
        <TaskCenterWorkbench />
      </div>
    </AppShell>
  );
}
