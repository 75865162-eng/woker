import { AppShell } from "@/components/app-shell/app-shell";
import { SellfoxWorkbench } from "@/components/sellfox/sellfox-workbench";

export default function SellfoxPage() {
  return (
    <AppShell title="Sellfox 同步" subtitle="Sellfox 店铺、在线商品与报表快照的独立工作台">
      <SellfoxWorkbench />
    </AppShell>
  );
}
