import { AppShell } from "@/components/app-shell/app-shell";
import { ListingAiWorkbench } from "@/components/app-shell/lazy-workbenches";

export default function ListingAiPage() {
  return (
    <AppShell title="Listing AI" subtitle="生成 Listing、主图附图、A+ 方案与右侧对话助手">
      <ListingAiWorkbench />
    </AppShell>
  );
}
