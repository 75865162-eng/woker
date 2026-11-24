import { AppShell } from '@/components/app-shell/app-shell';
import { SkuProfitFinalWorkbench } from '@/components/operations/sku-profit-final-workbench';

export default function SkuProfitFinalPage() {
  return <AppShell title="SKU 最终利润" subtitle="亚马逊结算真实数据 + 用户录入 SKU 成本，按配置汇率折算，算出每个 SKU 的最终净利润（缺成本/缺汇率留空，不造数）"><SkuProfitFinalWorkbench /></AppShell>;
}
