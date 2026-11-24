import { AppShell } from '@/components/app-shell/app-shell';
import { SkuCostWorkbench } from '@/components/operations/sku-cost-workbench';

export default function SkuCostPage() {
  return <AppShell title="SKU 成本录入" subtitle="按 SKU + 成本币种录入采购/头程/其他成本，供 SKU 最终利润折算使用（纯亚马逊模块，不接赛狐）"><SkuCostWorkbench /></AppShell>;
}
