import { AppShell } from '@/components/app-shell/app-shell';
import { PurchaseInvoicesWorkbench } from '@/components/operations/purchase-invoices-workbench';

export default function PurchaseInvoicesPage() {
  return <AppShell title="采购发票" subtitle="采购单 / 收货单 / 发票三单匹配，差异须带理由审批"><PurchaseInvoicesWorkbench /></AppShell>;
}
