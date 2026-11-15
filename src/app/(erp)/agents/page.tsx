import { AppShell } from "@/components/app-shell/app-shell";
import { AgentCenterWorkbench } from "@/components/agents/agent-center-workbench";
import Link from "next/link";

export default function AgentsPage() {
  return (
    <AppShell title="AI Agent 中心" subtitle="统一调度 Amazon AI Commerce OS 的业务 Agent、任务和审批">
      <Link href="/agents/selection-research" className="mb-[var(--gap-section)] inline-block rounded border px-[var(--pad-card)] py-2 text-sm">本地 AI 选品研究（隔离验证）</Link>
      <AgentCenterWorkbench />
    </AppShell>
  );
}
