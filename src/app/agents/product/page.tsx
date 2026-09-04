import { AppShell } from "@/components/app-shell/app-shell";
import { ProductAgentWorkbench } from "@/components/agents/product-agent-workbench";

export default function ProductAgentPage() {
  return (
    <AppShell
      title="产品 Agent"
      subtitle="Amazon 产品规划、PRD、成本目标和项目草案"
    >
      <ProductAgentWorkbench />
    </AppShell>
  );
}
