import { OrdersWorkbench } from '@/components/operations/orders-workbench';
import { createRoot } from 'react-dom/client';
import { ProcurementWorkbench } from '@/components/operations/procurement-workbench';
import { UnconnectedBusinessWorkbench } from '@/components/operations/unconnected-business-workbench';
import { WmsWorkbench } from '@/components/operations/wms-workbench';
import { AppShellUserProvider } from '@/components/app-shell/app-shell-context';
const params = new URLSearchParams(window.location.search);
localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'fixture-workspace' }));
const view = params.get('view') ?? 'purchase-orders';
const writable = params.get('readonly') !== '1';
createRoot(document.getElementById('root')!).render(<AppShellUserProvider value={{ userInitials: 'UI', userRole: 'fixture', rolePermissions: { fixture: { operations: writable ? ['view', 'create', 'edit'] : ['view'], wms: writable ? ['view', 'create'] : ['view'] } } }}>
<div className="mx-auto max-w-[1400px] p-6"><p className="mb-4 text-xs text-muted">隔离 UI 验证 · fixture 数据 · 无真实业务连接</p>{params.has('orders') ? <OrdersWorkbench getHeaders={() => new Headers()} onTask={() => {}} /> : params.has('wms') ? <WmsWorkbench initialTab={params.get('tab') ?? undefined} initialReceiptId={params.get("receiptId") ?? undefined} initialReceiptFilters={{ sourceReference: params.get('sourceReference') ?? undefined, workflowStatus: params.get('workflowStatus') ?? undefined }} /> : ['purchase-orders', 'suppliers'].includes(view) ? <ProcurementWorkbench initialView={view as 'purchase-orders' | 'suppliers'} /> : <UnconnectedBusinessWorkbench view={view} />}</div></AppShellUserProvider>);
