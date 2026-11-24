import { AppShell } from '@/components/app-shell/app-shell';
import { LogisticsQuoteWorkbench } from '@/components/operations/ext/logistics-quote-workbench';

export default function Page() {
  return <AppShell title="物流报价与采购报表" subtitle="物流渠道、集中询价、报价单、关联设置、采购退货与采购报表"><LogisticsQuoteWorkbench /></AppShell>;
}
