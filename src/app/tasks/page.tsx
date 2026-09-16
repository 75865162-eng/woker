import { AppShell } from "@/components/app-shell/app-shell";
import { TaskCenterWorkbench } from "@/components/app-shell/lazy-workbenches";

export default function TasksPage() {
  return (
    <AppShell title="任务中心" subtitle="导入、解析、导出任务的集中状态视图">
      <TaskCenterWorkbench />
    </AppShell>
  );
}
