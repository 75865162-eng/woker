import { FinanceWorkbench } from '@/components/operations/finance-workbench';
import { OrderItemsWorkbench } from '@/components/operations/order-items-workbench';
import { OrdersWorkbench } from '@/components/operations/orders-workbench';
import { OperationsHubWorkbench } from '@/components/operations/operations-hub-workbench';
import { useState } from 'react';
import { ObservationsWorkbench } from '@/components/operations/observations-workbench';
import { DomainReportsWorkbench } from '@/components/operations/domain-reports-workbench';
import { createRoot } from 'react-dom/client';
import { AppShellUserProvider } from '@/components/app-shell/app-shell-context';
import { BusinessNavigationDrawer } from '@/components/app-shell/business-navigation-drawer';
import { navigationGroups } from '@/components/app-shell/business-navigation';
import { roleCanAccessModule, type RolePermissionMap } from '@/lib/accounts/permissions';
import { SyncCenterWorkbench } from '@/components/operations/sync-center-workbench';
const params = new URLSearchParams(location.search);
const writable = !params.has('readonly');
const rolePermissions: RolePermissionMap = { fixture: { operations: writable ? ['view', 'create', 'edit'] : ['view'], wms: writable ? ['view', 'create', 'edit'] : ['view'] } };
const groups = navigationGroups.map(group => ({ ...group, items: group.items.filter(item => roleCanAccessModule('fixture', item.moduleId, rolePermissions)) })).filter(group => group.items.length);
localStorage.setItem('amazon_bulk_ad_workspace_scope', JSON.stringify({ workspaceId: 'fixture-workspace' }));
const getHeaders = () => new Headers({ 'x-workspace-id': 'fixture-workspace' });
function EvidenceHarness() {
  const [task, setTask] = useState('');
  return <><output aria-label="所选来源任务">{task}</output>{params.get('workbench') === 'finance' ? <FinanceWorkbench sellerAccountId="fixture-seller" marketplaceId="SITE" getHeaders={getHeaders} onTask={setTask} /> : params.get('workbench') === 'order-items' ? <OrderItemsWorkbench sellerAccountId="fixture-seller" marketplaceId="SITE" getHeaders={getHeaders} onTask={setTask} /> : params.get('workbench') === 'orders' ? <OrdersWorkbench sellerAccountId="fixture-seller" marketplaceId="SITE" getHeaders={getHeaders} onTask={setTask} /> : params.get('workbench') === 'inventory' ? <OperationsHubWorkbench embeddedTab="inventory" canSync={false} /> : params.has('observations') ? <ObservationsWorkbench resource={params.get('observations')!} sellerAccountId="fixture-seller" marketplaceId="SITE" getHeaders={getHeaders} onTask={setTask} /> : <DomainReportsWorkbench resource={params.get('reports')!} sellerAccountId="fixture-seller" marketplaceId="SITE" getHeaders={getHeaders} onTask={setTask} />}</>;
}
createRoot(document.getElementById('root')!).render(<AppShellUserProvider value={{ userId: 'fixture-user', userRole: 'fixture', userInitials: 'UI', rolePermissions }}>
  <div className="p-6"><p className="mb-4 text-xs text-muted">隔离 UI 验证 · fixture 数据 · 无真实业务连接</p><BusinessNavigationDrawer groups={groups} isActive={href => href === '/operations?view=fba-boxing'} />{params.has('observations') || params.has('reports') || params.has('workbench') ? <EvidenceHarness /> : <SyncCenterWorkbench />}</div>
</AppShellUserProvider>);
