import { AppShell } from "@/components/app-shell/app-shell";
import { SaihuSearchMergeHistory } from "@/components/saihu-search-merge/saihu-search-merge-history";

export default function HistoryPage() {
  return (
    <AppShell title="历史记录" subtitle="赛狐客搜词合并数据的本地上传和导出记录">
      <SaihuSearchMergeHistory />
    </AppShell>
  );
}
