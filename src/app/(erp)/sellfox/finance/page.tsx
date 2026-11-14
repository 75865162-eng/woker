import { AppShell } from "@/components/app-shell/app-shell";
import { HostWorkbench } from "@/components/sellfox/host/host-workbench";
import { hostPage } from "@/lib/sellfox/host-pages";

export const metadata = { title: "财务" };

export default function Page() {
  const page = hostPage("finance");
  if (!page) return null;
  return (
    <AppShell title={page.title} subtitle="赛狐结算、应收、发票与资金单据。Amazon 结算报告仍走 /operations。">
      <HostWorkbench page={page} />
    </AppShell>
  );
}
