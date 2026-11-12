import { AppShell } from "@/components/app-shell/app-shell";
import { ReplenishmentWorkbench } from "./_components/ReplenishmentWorkbench";

export const metadata = { title: "补货建议" };

export default function ReplenishmentPage() {
  return (
    <AppShell title="补货建议" subtitle="FBA → 补货建议。基于本地商品、销量与货件快照计算，不写入补货表。">
      <ReplenishmentWorkbench />
    </AppShell>
  );
}
