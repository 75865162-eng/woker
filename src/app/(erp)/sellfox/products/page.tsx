import { AppShell } from "@/components/app-shell/app-shell";
import { HostWorkbench } from "@/components/sellfox/host/host-workbench";
import { hostPage } from "@/lib/sellfox/host-pages";

export const metadata = { title: "商品资料" };

export default function Page() {
  const page = hostPage("products");
  if (!page) return null;
  return (
    <AppShell title={page.title} subtitle="赛狐商品主数据。ProductRecord 仍是唯一主档，赛狐只提供字段来源证据。">
      <HostWorkbench page={page} />
    </AppShell>
  );
}
