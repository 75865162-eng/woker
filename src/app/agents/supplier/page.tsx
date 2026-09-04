import { AppShell } from "@/components/app-shell/app-shell";
import { SupplierAgentWorkbench } from "@/components/agents/supplier-agent-workbench";

export default function SupplierAgentPage() {
  return (
    <AppShell
      title="供应 Agent"
      subtitle="Amazon 供应商推荐、报价分析、RFQ 草稿和采购项目"
    >
      <SupplierAgentWorkbench />
    </AppShell>
  );
}
