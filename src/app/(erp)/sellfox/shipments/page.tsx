import { AppShell } from "@/components/app-shell/app-shell";
import { FbaShipmentsWorkbench } from "./_components/FbaShipmentsWorkbench";

export const metadata = { title: "货件" };

export default function FbaShipmentsPage() {
  return (
    <AppShell title="货件" subtitle="FBA → 货件。按货件行读取最近一次完整采集的赛狐货件快照。">
      <FbaShipmentsWorkbench />
    </AppShell>
  );
}
