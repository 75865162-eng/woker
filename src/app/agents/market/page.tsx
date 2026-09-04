import { AppShell } from "@/components/app-shell/app-shell";
import { MarketAgentWorkbench } from "@/components/agents/market-agent-workbench";

export default function MarketAgentPage() {
  return (
    <AppShell
      title="市场 Agent"
      subtitle="Amazon 市场机会发现、证据聚合、机会评分和项目审批"
    >
      <MarketAgentWorkbench />
    </AppShell>
  );
}
