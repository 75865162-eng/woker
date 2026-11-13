import { AppShell } from '@/components/app-shell/app-shell';
import { TaxWorkbench } from '@/components/operations/ext/tax-workbench';

export default function Page() {
  return <AppShell title="税务与发票台账" subtitle="VAT/GST 发票台账与申报期归集、申报留痕"><TaxWorkbench /></AppShell>;
}
