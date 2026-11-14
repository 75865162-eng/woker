import { AppShell } from "@/components/app-shell/app-shell";
import { HostWorkbench } from "@/components/sellfox/host/host-workbench";
import { hostPage } from "@/lib/sellfox/host-pages";

export const metadata = { title: "库存" };

export default function Page() {
  const page = hostPage("inventory");
  if (!page) return null;
  return (
    <AppShell title={page.title} subtitle="赛狐 FBA 库存快照与本地仓/流水/库龄。与 Amazon 库存并列对照，不相减。">
      <HostWorkbench page={page} />
    </AppShell>
  );
}
