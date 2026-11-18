import { AppShell } from '@/components/app-shell/app-shell';
import { CalculatorsWorkbench } from '@/components/operations/ext/calculators-workbench';

export default function Page() {
  return <AppShell title="计算器中心" subtitle="FBA 费用测算、仓储费用参考与方案快照"><CalculatorsWorkbench /></AppShell>;
}
