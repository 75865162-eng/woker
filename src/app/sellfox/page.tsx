import { AppShell } from "@/components/app-shell/app-shell";
import { SellfoxWorkbench } from "@/components/sellfox/sellfox-workbench";

export const metadata = { title: "销量统计 / 销售利润" };

export default function SellfoxPage() {
  return (
    <AppShell title="销量统计 / 销售利润" subtitle="按店铺、商品和业务日期查看销量、利润与广告表现">
      <SellfoxWorkbench />
    </AppShell>
  );
}
