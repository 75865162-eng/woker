import { AppShell } from '@/components/app-shell/app-shell';
import { SalesPlansWorkbench } from '@/components/operations/ext/sales-plans-workbench';

export default function Page() {
  return <AppShell title="销售计划与预测" subtitle="按 SKU 拆目标、历史日均预测与实际偏差"><SalesPlansWorkbench /></AppShell>;
}
