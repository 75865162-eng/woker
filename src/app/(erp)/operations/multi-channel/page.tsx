import { AppShell } from '@/components/app-shell/app-shell';
import { MultiChannelWorkbench } from '@/components/operations/ext/multi-channel-workbench';

export default function Page() {
  return <AppShell title="多渠道经营" subtitle="eBay/Walmart/Temu/TikTok/Shopify 店铺与订单"><MultiChannelWorkbench /></AppShell>;
}
