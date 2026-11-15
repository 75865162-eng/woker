import { AppShell } from '@/components/app-shell/app-shell';
import { PurchasePlansWorkbench } from '@/components/operations/purchase-plans-workbench';

export default function PurchasePlansPage() {
  return <AppShell title="采购计划" subtitle="按销量与库存缺口推算需求，人工确认后转采购单"><PurchasePlansWorkbench /></AppShell>;
}
