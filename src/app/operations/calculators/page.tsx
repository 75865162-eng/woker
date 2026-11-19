import { AppShell } from '@/components/app-shell/app-shell';
import { CalculatorsWorkbench } from '@/components/operations/ext/calculators-workbench';

export default function Page() {
  return <AppShell title="计算器中心" subtitle="FBA 费用测算与仓储费用参考"><CalculatorsWorkbench /></AppShell>;
}
