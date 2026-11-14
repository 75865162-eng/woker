import { AppShell } from "@/components/app-shell/app-shell";
import { HostWorkbench } from "@/components/sellfox/host/host-workbench";
import { hostPage } from "@/lib/sellfox/host-pages";

export const metadata = { title: "采购" };

export default function Page() {
  const page = hostPage("purchase");
  if (!page) return null;
  return (
    <AppShell title={page.title} subtitle="赛狐采购单、入库单、计划与供应商。本地 ERP 采购仍是主档，赛狐只做对照。">
      <HostWorkbench page={page} />
    </AppShell>
  );
}
