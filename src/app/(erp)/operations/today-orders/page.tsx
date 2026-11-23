import { AppShell } from '@/components/app-shell/app-shell';
import { TodayOrderWorkbench } from '@/components/operations/today-order-workbench';

export default function TodayOrdersPage() {
  return <AppShell title="今日订单看板" subtitle="今日/昨日/上周同日三日并列 + 库存拼合，周月订单汇总（缺日不补零，币种分列）"><TodayOrderWorkbench /></AppShell>;
}
