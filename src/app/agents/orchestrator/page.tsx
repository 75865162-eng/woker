import { AppShell } from "@/components/app-shell/app-shell";
import { OrchestratorAgentWorkbench } from "@/components/agents/orchestrator-agent-workbench";

export default function OrchestratorAgentPage() {
  return (
    <AppShell
      title="Agent 编排器"
      subtitle="串联市场、产品、供应、刊登、上架与 PPC 的统一编排中心"
    >
      <OrchestratorAgentWorkbench />
    </AppShell>
  );
}
