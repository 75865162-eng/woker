import { AppShell } from "@/components/app-shell/app-shell";
import { SaihuSearchMergeWorkbench } from "@/components/app-shell/lazy-workbenches";

export default function SaihuSearchMergePage() {
  return (
    <AppShell title="赛狐搜索词合并" subtitle="按用户搜索词合并广告订单、曝光、点击、花费与效率指标">
      <SaihuSearchMergeWorkbench />
    </AppShell>
  );
}
