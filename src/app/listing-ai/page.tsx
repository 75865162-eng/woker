import { AppShell } from "@/components/app-shell/app-shell";
import { ListingAiWorkbench } from "@/components/listing-ai/listing-ai-workbench";

export default function ListingAiPage() {
  return (
    <AppShell title="Listing AI" subtitle="一键生成 Listing、主图附图、A+ 方案与美工自检清单">
      <ListingAiWorkbench />
    </AppShell>
  );
}
