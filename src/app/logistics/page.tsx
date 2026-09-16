import { AppShell } from "@/components/app-shell/app-shell";
import { LogisticsWorkbench } from "@/components/app-shell/lazy-workbenches";

export default function LogisticsPage() {
  return (
    <AppShell title="亚马逊物流处理系统（美国站）" subtitle="装箱表、发货模板、包装箱表、箱唛 PDF 和物流模板处理">
      <LogisticsWorkbench />
    </AppShell>
  );
}
