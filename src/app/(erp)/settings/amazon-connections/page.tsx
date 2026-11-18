import { AppShell } from "@/components/app-shell/app-shell";
import { AmazonConnections } from "@/components/settings/amazon-connections";

export default function AmazonConnectionsPage() {
  return (
    <AppShell title="Amazon 连接管理" subtitle="独立管理 Amazon SP-API 与 Ads API 连接，赛狐连接保持在系统设置集成页">
      <AmazonConnections />
    </AppShell>
  );
}
