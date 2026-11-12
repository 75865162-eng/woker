import { AppShell } from "@/components/app-shell/app-shell";
import { AgentDetailWorkbench } from "@/components/agents/agent-detail-workbench";

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;

  return (
    <AppShell title="Agent 详情" subtitle="查看 Agent 定义、执行历史、轨迹、建议和审批">
      <AgentDetailWorkbench agentId={agentId} />
    </AppShell>
  );
}
