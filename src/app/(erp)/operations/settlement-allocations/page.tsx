import { AppShell } from '@/components/app-shell/app-shell';
import { SettlementAllocationWorkbench } from '@/components/operations/settlement-allocation-workbench';

export default function SettlementAllocationsPage() {
  return <AppShell title="结算 SKU 分摊" subtitle="已发布结算行的店铺费用到 SKU 分摊、重叠去重与财务交接"><SettlementAllocationWorkbench /></AppShell>;
}
