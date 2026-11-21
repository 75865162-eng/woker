import { AppShell } from "@/components/app-shell/app-shell";
import { ApprovalCenter } from "@/components/approvals/approval-center";

export default function ApprovalsPage() {
  return (
    <AppShell title="审批中心" subtitle="我审批的 / 我发起的 · 跨采购 / 仓库 / 财务统一待办">
      <ApprovalCenter />
    </AppShell>
  );
}
