import { AppShell } from '@/components/app-shell/app-shell';
import { FxRateWorkbench } from '@/components/operations/fx-rate-workbench';

export default function FxRatePage() {
  return <AppShell title="汇率配置" subtitle="用户显式录入成本币种→结算币种汇率（如 CNY→USD），用于 SKU 最终利润折算；系统不自动抓汇率"><FxRateWorkbench /></AppShell>;
}
