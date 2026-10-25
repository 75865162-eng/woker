import { AppShell } from "@/components/app-shell/app-shell";
import { SelectionEvidenceFormWorkbench } from "@/components/agents/selection-evidence-form-workbench";

export default function SelectionEvidencePage() {
  return <AppShell title="选品证据补全" subtitle="补低星评论与 1688 供应线索，重建 quality 后再考虑上传/建 SKU"><SelectionEvidenceFormWorkbench /></AppShell>;
}
