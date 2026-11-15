import { AppShell } from "@/components/app-shell/app-shell";
import { SyncConsole } from "@/components/sellfox/host/sync-console";

export const metadata = { title: "同步控制台" };

export default function Page() {
  return (
    <AppShell title="同步控制台" subtitle="赛狐全量同步编排：节奏、覆盖矩阵、首跑顺序与运行记录。">
      <SyncConsole />
    </AppShell>
  );
}
