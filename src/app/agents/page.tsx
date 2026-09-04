import { AppShell } from "@/components/app-shell/app-shell";
import { AgentCenterWorkbench } from "@/components/agents/agent-center-workbench";

export default function AgentsPage() {
  return (
    <AppShell title="AI Agent 中心" subtitle="统一调度 Amazon AI Commerce OS 的业务 Agent、任务和审批">
      <AgentCenterWorkbench />
    </AppShell>
  );
}
