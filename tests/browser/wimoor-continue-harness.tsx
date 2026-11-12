import { createRoot } from 'react-dom/client';
import { AppShellUserProvider } from '@/components/app-shell/app-shell-context';
import { WmsWorkbench } from '@/components/operations/wms-workbench';
import { PurchasePaymentRecords } from '@/components/operations/purchase-payment-records';
const readOnly = new URLSearchParams(window.location.search).has('readonly');
localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'fixture-workspace' }));
createRoot(document.getElementById('root')!).render(<AppShellUserProvider value={{ userId: 'fixture-user', userInitials: 'UI', userRole: 'fixture', rolePermissions: { fixture: { wms: readOnly ? ['view'] : ['view', 'create', 'edit'] } } }}>
  <main className="p-6"><p>隔离 UI 验证 · fixture 单据 · 无真实业务连接</p>{new URLSearchParams(window.location.search).has('payments') ? <PurchasePaymentRecords payments={[{ id: 'fixture-payment', reference: 'FIXTURE-PAYMENT-01', amount: '9007199254740993.123456', currency: 'CNY', paidAt: '2026-11-12T00:00:00Z', method: 'BANK_TRANSFER', notes: '隔离付款凭据', refunds: [{ id: 'fixture-refund', refundedAt: '2026-11-13T00:00:00Z', amount: '2.000001', currency: 'CNY', method: 'BANK_TRANSFER', reference: 'FIXTURE-REFUND-01', notes: '隔离退款凭据' }] }]} /> : <WmsWorkbench initialTab="transfer-orders" />}</main>
</AppShellUserProvider>);
