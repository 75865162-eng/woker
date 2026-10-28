import { AppShell } from "@/components/app-shell/app-shell";
import { SellfoxWorkbench } from "@/components/sellfox/sellfox-workbench";

export const metadata = { title: "销量统计 / 销售利润" };

export default function SellfoxPage() {
  return (
    <AppShell title="销量统计 / 销售利润" subtitle="销量统计、销售利润、在线产品与广告产品；灰色控件表示赛狐网页有、本地尚无对应数据">
      <SellfoxWorkbench />
    </AppShell>
  );
}
