import { AppShell } from "@/components/app-shell/app-shell";
import { ResearchWorkbench } from "@/components/selection-research/research-workbench";

export default function SelectionResearchPage() {
  return <AppShell title="本地 AI 选品研究" subtitle="五阶段流程 · 两次人工确认 · 证据追溯"><ResearchWorkbench /></AppShell>;
}
