import { AppShell } from "@/components/app-shell/app-shell";
import { HostWorkbench } from "@/components/sellfox/host/host-workbench";
import { hostPage } from "@/lib/sellfox/host-pages";

export const metadata = { title: "利润报表" };

export default function Page() {
  const page = hostPage("profit");
  if (!page) return null;
  return (
    <AppShell title={page.title} subtitle="产品日利润 / 按日利润 8 维 / 月利润 / 结算利润，三套口径分表存。">
      <HostWorkbench page={page} />
    </AppShell>
  );
}
