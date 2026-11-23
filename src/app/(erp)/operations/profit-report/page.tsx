import { AppShell } from '@/components/app-shell/app-shell';
import { ProfitReportWorkbench } from '@/components/operations/profit-report-workbench';

export default function ProfitReportPage() {
  return <AppShell title="利润报表" subtitle="SKU 与店铺两级汇总（保守口径：原币不折算、成本/广告/税费分列，待确认项标注）"><ProfitReportWorkbench /></AppShell>;
}
