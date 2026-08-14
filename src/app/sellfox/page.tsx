import { AppShell } from "@/components/app-shell/app-shell";
import { SellfoxWorkbench } from "@/components/sellfox/sellfox-workbench";

export default function SellfoxPage() {
  return <AppShell title="Sellfox 同步" subtitle="店铺、商品与广告小时报告的只读数据闭环"><SellfoxWorkbench /></AppShell>;
}
