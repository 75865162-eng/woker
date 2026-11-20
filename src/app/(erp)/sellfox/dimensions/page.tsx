import { AppShell } from "@/components/app-shell/app-shell";
import { DimensionAnalysisWorkbench } from "@/components/sellfox/dimension-analysis-workbench";

export const metadata = { title: "维度分析" };

export default function DimensionsPage() {
  return (
    <AppShell title="维度分析" subtitle="业务员 / 店铺 / 站点三个维度的名单与关联清单；只列本地快照已有的实体与关联，不补 0、不臆造。">
      <DimensionAnalysisWorkbench />
    </AppShell>
  );
}
