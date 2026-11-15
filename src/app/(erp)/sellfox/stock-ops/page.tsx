import { AppShell } from "@/components/app-shell/app-shell";
import { HostWorkbench } from "@/components/sellfox/host/host-workbench";
import { hostPage } from "@/lib/sellfox/host-pages";

export const metadata = { title: "出入库" };

export default function Page() {
  const page = hostPage("stock-ops");
  if (!page) return null;
  return (
    <AppShell title={page.title} subtitle="其他出入库、调整、调拨、盘点、加工与拆分单，只读快照。">
      <HostWorkbench page={page} />
    </AppShell>
  );
}
