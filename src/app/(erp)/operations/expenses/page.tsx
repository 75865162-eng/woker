import { AppShell } from '@/components/app-shell/app-shell';
import { FinanceExpensesWorkbench } from '@/components/operations/finance-expenses-workbench';

export default function FinanceExpensesPage() {
  return <AppShell title="ERP 费用单" subtitle="费用申请、独立复核与总账凭证草稿"><FinanceExpensesWorkbench /></AppShell>;
}
