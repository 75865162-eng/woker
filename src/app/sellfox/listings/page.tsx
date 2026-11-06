import { AppShell } from "@/components/app-shell/app-shell";
import { OnlineProductsWorkbench } from "./_components/OnlineProductsWorkbench";

export const metadata = { title: "在线产品" };

export default function OnlineProductsPage() {
  return (
    <AppShell title="在线产品" subtitle="销售 → 在线产品。读取本地 SellfoxListingSnapshot。">
      <OnlineProductsWorkbench />
    </AppShell>
  );
}
