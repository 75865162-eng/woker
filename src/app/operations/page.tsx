import { AppShell } from "@/components/app-shell/app-shell";
import { OperationsHubWorkbench } from "@/components/operations/operations-hub-workbench";

export default function OperationsPage() {
  return (
    <AppShell title="经营中台" subtitle="Amazon 数据连接、同步状态与后续经营决策的统一入口">
      <OperationsHubWorkbench />
    </AppShell>
  );
}
