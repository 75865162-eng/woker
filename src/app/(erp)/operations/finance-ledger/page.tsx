import { AppShell } from "@/components/app-shell/app-shell";
import { FinanceLedgerWorkbench } from "@/components/operations/finance-ledger-workbench";

export default function FinanceLedgerPage() {
  return (
    <AppShell title="ERP 总账" subtitle="账套、期间、会计科目、凭证与试算平衡">
      <FinanceLedgerWorkbench />
    </AppShell>
  );
}
