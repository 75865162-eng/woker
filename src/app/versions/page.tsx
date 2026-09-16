import { AppShell } from "@/components/app-shell/app-shell";
import { VersionHistoryWorkbench } from "@/components/app-shell/lazy-workbenches";

export default function VersionsPage() {
  return (
    <AppShell title="版本审计" subtitle="产品资料、Listing 草稿、PPC 草稿和规则配置的改动历史">
      <VersionHistoryWorkbench />
    </AppShell>
  );
}
