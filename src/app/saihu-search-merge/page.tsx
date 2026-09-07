import { AppShell } from "@/components/app-shell/app-shell";
import { SaihuSearchMergeWorkbench } from "@/components/app-shell/lazy-workbenches";
import { History } from "lucide-react";
import Link from "next/link";

export default function SaihuSearchMergePage() {
  return (
    <AppShell
      title="赛狐搜索词合并"
      subtitle="按用户搜索词合并广告订单、曝光、点击、花费与效率指标"
      actions={
        <Link
          href="/history"
          prefetch={false}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-surface-muted"
        >
          <History className="h-4 w-4" />
          历史记录
        </Link>
      }
    >
      <SaihuSearchMergeWorkbench />
    </AppShell>
  );
}
