import { AppShell } from "@/components/app-shell/app-shell";
import { PpcAgentWorkbench } from "@/components/agents/ppc-agent-workbench";

export default function PpcAgentPage() {
  return (
    <AppShell
      title="PPC 广告 Agent"
      subtitle="Amazon Ads、SellerSprite、历史 PPC 与商品数据驱动的诊断和审批建议"
    >
      <PpcAgentWorkbench />
    </AppShell>
  );
}
