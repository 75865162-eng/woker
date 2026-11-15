import { AppShell } from '@/components/app-shell/app-shell';
import { ProcurementCollabWorkbench } from '@/components/operations/ext/procurement-collab-workbench';

export default function Page() {
  return <AppShell title="采购协同" subtitle="请款单、换货单与供应商报价比价"><ProcurementCollabWorkbench /></AppShell>;
}
