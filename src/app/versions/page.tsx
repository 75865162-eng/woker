import { AppShell } from "@/components/app-shell/app-shell";
import { VersionHistoryWorkbench } from "@/components/app-shell/lazy-workbenches";
import { DataSourceBanner } from "@/components/ui/data-source-banner";

export default function VersionsPage() {
  return (
    <AppShell title="版本审计" subtitle="产品资料、Listing 草稿、PPC 草稿和规则配置的改动历史">
      <div className="space-y-5">
        <DataSourceBanner
          tone="mixed"
          title="版本历史按组织和工作区记录"
          description="可回答谁在什么时候改了什么，并支持将当前工作区恢复到指定版本。"
        />
        <VersionHistoryWorkbench />
      </div>
    </AppShell>
  );
}
