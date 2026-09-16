import { AppShell } from "@/components/app-shell/app-shell";
import { ListingAgentWorkbench } from "@/components/agents/listing-agent-workbench";

export default function ListingAgentPage() {
  return (
    <AppShell
      title="刊登 Agent"
      subtitle="Amazon Listing 关键词图谱、标题、要点、描述、A+ 简报和草稿审批"
    >
      <ListingAgentWorkbench />
    </AppShell>
  );
}
