import { AppShell } from "@/components/app-shell/app-shell";
import { HostWorkbench } from "@/components/sellfox/host/host-workbench";
import { hostPage } from "@/lib/sellfox/host-pages";

export const metadata = { title: "广告报表" };

export default function Page() {
  const page = hostPage("ads");
  if (!page) return null;
  return (
    <AppShell title={page.title} subtitle="赛狐 CPC 六类日报、管理实体、小时曲线与 ABA 搜索词。">
      <HostWorkbench page={page} />
    </AppShell>
  );
}
