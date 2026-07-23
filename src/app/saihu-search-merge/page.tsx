import { AppShell } from "@/components/app-shell/app-shell";
import { SaihuSearchMergeWorkbench } from "@/components/saihu-search-merge/saihu-search-merge-workbench";

export default function SaihuSearchMergePage() {
  return (
    <AppShell title="赛狐客搜词合并数据" subtitle="上传赛狐搜索词报表，按用户搜索词合并广告订单、曝光、点击、花费与效率指标">
      <SaihuSearchMergeWorkbench />
    </AppShell>
  );
}
