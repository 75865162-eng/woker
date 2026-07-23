import { AppShell } from "@/components/app-shell/app-shell";
import { LogisticsWorkbench } from "@/components/logistics/logistics-workbench";

export default function LogisticsPage() {
  return (
    <AppShell title="亚马逊物流处理系统（美国站）" subtitle="上传装箱表、发货模板、包装箱表、箱唛 PDF、物流模板，自动生成发货与物流文件">
      <LogisticsWorkbench />
    </AppShell>
  );
}
