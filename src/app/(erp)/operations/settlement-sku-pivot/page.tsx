import { AppShell } from '@/components/app-shell/app-shell';
import { SettlementSkuPivotWorkbench } from '@/components/operations/settlement-sku-pivot-workbench';

export default function SettlementSkuPivotPage() {
  return <AppShell title="结算 SKU 透视" subtitle="已发布结算分摊行的 8 类费用透视汇总（原币不折算，口径标注）"><SettlementSkuPivotWorkbench /></AppShell>;
}
