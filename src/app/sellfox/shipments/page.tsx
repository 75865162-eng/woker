import { AppShell } from "@/components/app-shell/app-shell";
import { FbaShipmentsWorkbench } from "./_components/FbaShipmentsWorkbench";

export const metadata = { title: "货件" };

export default function FbaShipmentsPage() {
  return (
    <AppShell title="货件" subtitle="FBA → 货件。尚无赛狐货件表，只显示空态。">
      <FbaShipmentsWorkbench />
    </AppShell>
  );
}
