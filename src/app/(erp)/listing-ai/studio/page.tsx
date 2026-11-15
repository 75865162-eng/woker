import { AppShell } from "@/components/app-shell/app-shell";
import { ListingAiStudioWorkbench } from "@/components/app-shell/lazy-workbenches";

export default function ListingAiStudioPage() {
  return (
    <AppShell
      title="Listing 生成台"
      subtitle="填产品特点、参数、规格直出标题描述，竞品图生图，结果按项对比"
    >
      <ListingAiStudioWorkbench />
    </AppShell>
  );
}
