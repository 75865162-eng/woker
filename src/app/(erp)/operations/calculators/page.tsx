import { AppShell } from '@/components/app-shell/app-shell';
import { CalculatorsWorkbench } from '@/components/operations/ext/calculators-workbench';

export default function Page() {
  return <AppShell title="计算器中心" subtitle="FBA 费用与利润测算，含保本价反算与方案快照"><CalculatorsWorkbench /></AppShell>;
}
