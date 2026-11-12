import {FbaRemoteActions} from '@/components/operations/fba-remote-actions';
import {FbaWorkflowOptions} from '@/components/operations/fba-workflow-options';
import type {FbaLocalPlansResult} from '@/lib/fba-local/service';
import {createRoot} from 'react-dom/client';
import {FinanceLedgerWorkbench} from '@/components/operations/finance-ledger-workbench';
import {AppShellUserProvider} from '@/components/app-shell/app-shell-context';
localStorage.setItem('amazon_bulk_ad_workspace_scope',JSON.stringify({workspaceId:'fixture-workspace'}));
const optionPlan={id:'plan',revision:4,status:'DRAFT',workflowOptions:[{id:'snapshot',kind:'PLACEMENT',externalPlanId:'AMZ-PLAN',operationId:'AMZ-OP',capturedAt:'2026-11-12T00:00:00Z',expiresAt:'2026-12-01T00:00:00Z',sourceHash:'source-hash',createdBy:'other-operator',evidence:'External returned options',selection:null}]} as unknown as FbaLocalPlansResult['items'][number];
createRoot(document.getElementById('root')!).render(location.pathname==='/fixture-remote'?<FbaRemoteActions planId="plan" revision={4} workspaceId="fixture-workspace"/>:location.pathname==='/fixture-options'?<FbaWorkflowOptions plan={optionPlan} workspaceId="fixture-workspace" userId="fixture-reviewer" canEdit={false} canReview={true} onSaved={()=>{}}/>:<AppShellUserProvider value={{userId:'fixture-operator',userRole:'owner',userInitials:'UI',rolePermissions:{owner:{operations:['view','create','approve']}}}}><FinanceLedgerWorkbench/></AppShellUserProvider>);
