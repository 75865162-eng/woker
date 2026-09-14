import { AppShell } from "@/components/app-shell/app-shell";
import { SellfoxWorkbench } from "@/components/sellfox/sellfox-workbench";

export default function SellfoxPage() {
  return (
    <AppShell title="Sellfox 报表同步" subtitle="Sellfox 店铺、小时指标与产品表现快照">
      <SellfoxWorkbench />
    </AppShell>
  );
}
