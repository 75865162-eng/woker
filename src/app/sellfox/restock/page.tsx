import { AppShell } from "@/components/app-shell/app-shell";
import { ReplenishmentWorkbench } from "./_components/ReplenishmentWorkbench";

export const metadata = { title: "补货建议" };

export default function ReplenishmentPage() {
  return (
    <AppShell title="补货建议" subtitle="FBA → 补货建议。尚无赛狐补货表，只显示空态。">
      <ReplenishmentWorkbench />
    </AppShell>
  );
}
