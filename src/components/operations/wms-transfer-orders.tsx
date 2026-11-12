'use client';
import {useRef,useState} from 'react';
import {roleCanPerformAction} from '@/lib/accounts/permissions';
import {WmsTransferTable, type TransferOrderView} from './wms-transfer-table';
import {useAppShellUser} from '@/components/app-shell/app-shell-context';
import type {WmsCommandInput} from '@/lib/wms/contracts';
import {Button} from '@/components/ui/button';
import {WorkbenchDialog} from '@/components/ui/workbench-dialog';
import {useWmsOptions} from './use-wms-options';
import {WmsOptionsStatus} from './wms-options-status';
type Item=Record<string,unknown>;
type Order=TransferOrderView;
const cls='h-9 rounded border border-input bg-background px-2';
export function WmsTransferOrders({items,workspaceId,disabled,onSaved,onApprovalRequested}:{items:Item[];workspaceId:string;disabled:boolean;onSaved:()=>void;onApprovalRequested:(orderId?:string)=>void}){
 const [dialogBusy,setDialogBusy]=useState(false);const user=useAppShellUser(),[open,setOpen]=useState(false),[job,setJob]=useState<{order:Order;action:'TRANSFER_ORDER_SHIP'|'TRANSFER_ORDER_RECEIVE'|'TRANSFER_ORDER_CANCEL'}|null>(null);
 const canCreate=roleCanPerformAction(user?.userRole,'wms','create',user?.rolePermissions);
 const canEdit=roleCanPerformAction(user?.userRole,'wms','edit',user?.rolePermissions);
 const actions=(order:Order)=>!['COMPLETED','CANCELLED'].includes(order.status)?<>
   {canEdit&&order.createdBy===user?.userId&&order.lines.some(line=>line.shippedQty<line.quantity)&&<Button size="sm" disabled={disabled} onClick={()=>setJob({order,action:'TRANSFER_ORDER_SHIP'})}>申请调拨发出</Button>}
   {canEdit&&order.lines.some(line=>line.shippedQty>line.receivedQty)&&<Button size="sm" disabled={disabled} onClick={()=>setJob({order,action:'TRANSFER_ORDER_RECEIVE'})}>申请调拨签收</Button>}
   {canEdit&&order.createdBy===user?.userId&&order.status==='DRAFT'&&<Button size="sm" variant="secondary" disabled={disabled} onClick={()=>setJob({order,action:'TRANSFER_ORDER_CANCEL'})}>取消调拨草稿</Button>}
 </>:null;
 return <section aria-label="在途调拨单" className="space-y-3">
   <div className="flex flex-wrap items-center gap-3">{canCreate&&<Button size="sm" disabled={disabled} onClick={()=>setOpen(true)}>新建在途调拨</Button>}<p className="text-sm text-muted">草稿不占库存；发出及签收分别审批，在途数量不计入目的可用库存。</p></div>
   <WmsTransferTable orders={items as unknown as Order[]} disabled={disabled} actions={actions} onApprovals={onApprovalRequested}/>
   <WorkbenchDialog busy={dialogBusy} open={open&&canCreate} title="新建在途调拨" onClose={()=>setOpen(false)}><TransferDraftForm onBusy={setDialogBusy} workspaceId={workspaceId} onSaved={()=>{setOpen(false);onSaved();}}/></WorkbenchDialog>
   <WorkbenchDialog busy={dialogBusy} open={!!job&&canEdit&&items.some(item=>item.id===job.order.id)} title="调拨作业" onClose={()=>setJob(null)}>{job&&<TransferActionForm onBusy={setDialogBusy} key={`${job.order.id}:${job.action}:${job.order.revision}`} workspaceId={workspaceId} {...job} onSaved={()=>{setJob(null);if(job.action==='TRANSFER_ORDER_CANCEL')onSaved();else onApprovalRequested(job.order.id);}}/>}</WorkbenchDialog>
 </section>;
}
// Wimoor transfer/components/create.vue: header form → stock line table → save.
// Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt.
function TransferDraftForm({workspaceId,onSaved,onBusy}:{workspaceId:string;onSaved:()=>void;onBusy:(busy:boolean)=>void}){
 const balances=useWmsOptions('balances',workspaceId,true),locations=useWmsOptions('locations',workspaceId,true);
 const [number,setNumber]=useState(''),[reason,setReason]=useState('');
 const [lines,setLines]=useState([{sourceBalanceId:'',targetLocationId:'',quantity:''}]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<{fingerprint:string;key:string}|null>(null),lock=useRef(false);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);onBusy(true);setError('');
  try{
   const body={number,reason,lines:lines.map(line=>({...line,quantity:Number(line.quantity)}))};
   const fingerprint=JSON.stringify(body);
   if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,key:crypto.randomUUID()};
   const response=await fetch('/api/operations/wms/transfer-orders',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({...body,idempotencyKey:pending.current.key})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'保存失败。');onSaved();
  }catch(cause){setError(cause instanceof Error?cause.message:'保存失败。');}
  finally{lock.current=false;setBusy(false);onBusy(false);}
 }
 return <form aria-label="在途调拨草稿" className="space-y-4" onSubmit={submit}><fieldset disabled={busy} className="space-y-4">
  <div className="grid gap-4 rounded border border-border p-4 sm:grid-cols-2"><label className="grid gap-1 text-sm">调拨单号<input required maxLength={120} aria-label="在途调拨单号" value={number} onChange={event=>setNumber(event.target.value)} className={cls}/></label><label className="grid gap-1 text-sm">调拨依据<input required maxLength={500} aria-label="调拨依据" value={reason} onChange={event=>setReason(event.target.value)} className={cls}/></label></div>
  <p className="text-xs text-muted">创建草稿 → 申请发出 → 独立审批及执行 → 申请签收 → 独立审批及执行。草稿不冻结库存，实际作业会重新校验可用数量和单据版本。</p>
  <WmsOptionsStatus label="来源库存" options={balances}/><WmsOptionsStatus label="目的库位" options={locations}/>
  <div className="overflow-x-auto"><table aria-label="调拨草稿商品明细" className="w-full min-w-[700px] text-left text-sm"><thead><tr>{['来源库存（仓库 / 库位 / 批次）','目的存储库位','计划数量','操作'].map(label=><th key={label} className="border-b border-border p-2">{label}</th>)}</tr></thead><tbody>{lines.map((line,index)=><tr key={index} className="border-b border-border">
   <td className="p-2"><select required aria-label={`调拨明细${index+1}来源`} value={line.sourceBalanceId} onChange={event=>setLines(current=>current.map((row,i)=>i===index?{...row,sourceBalanceId:event.target.value}:row))} className={cls}><option value="">选择来源</option>{balances.items.filter(row=>Number(row.available)>0).map(row=>{const stock=row.stock as Item|undefined;return <option key={String(row.id)} value={String(row.id)}>{String(stock?.warehouseCode)} / {String(stock?.locationCode)} / {String(stock?.lotCode)} · 可用 {String(row.available)}</option>;})}</select></td>
   <td className="p-2"><select required aria-label={`调拨明细${index+1}目的`} value={line.targetLocationId} onChange={event=>setLines(current=>current.map((row,i)=>i===index?{...row,targetLocationId:event.target.value}:row))} className={cls}><option value="">选择目的</option>{locations.items.filter(row=>row.enabled===true&&row.frozen!==true&&row.kind==='STORAGE').map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.warehouseId)} / {String(row.code)}</option>)}</select></td>
   <td className="p-2"><input required type="number" min={1} step={1} aria-label={`调拨明细${index+1}数量`} value={line.quantity} onChange={event=>setLines(current=>current.map((row,i)=>i===index?{...row,quantity:event.target.value}:row))} className={cls}/></td>
   <td className="p-2"><Button type="button" variant="ghost" disabled={lines.length===1} aria-label={`移除调拨明细${index+1}`} onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}>移除此行</Button></td>
  </tr>)}</tbody></table></div>
  <div className="flex flex-wrap justify-between gap-3"><Button type="button" variant="secondary" disabled={lines.length>=100} onClick={()=>setLines(current=>[...current,{sourceBalanceId:'',targetLocationId:'',quantity:''}])}>添加调拨明细</Button><Button type="submit">保存调拨草稿</Button></div>
 </fieldset>{error&&<p role="alert" className="text-red-600">{error}</p>}</form>;
}
function TransferActionForm({workspaceId,order,action,onSaved,onBusy}:{onBusy:(busy:boolean)=>void;workspaceId:string;order:Order;action:'TRANSFER_ORDER_SHIP'|'TRANSFER_ORDER_RECEIVE'|'TRANSFER_ORDER_CANCEL';onSaved:()=>void}){
 const [quantities,setQuantities]=useState<Record<string,string>>({}),[reference,setReference]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const pending=useRef<WmsCommandInput|null>(null),lock=useRef(false);const cancel=action==='TRANSFER_ORDER_CANCEL';
 return <form aria-label="在途调拨作业" className="space-y-3" onSubmit={event=>{event.preventDefault();if(lock.current)return;const lines=order.lines.filter(line=>Number(quantities[line.id])>0).map(line=>({lineId:line.id,quantity:Number(quantities[line.id])}));if(!cancel&&!lines.length){setError('至少填写一条作业数量。');return;}pending.current??={workspaceId,aggregateId:order.id,expectedRevision:order.revision,idempotencyKey:crypto.randomUUID(),payload:cancel?{action,reason:reference}:{action,reference,lines}};lock.current=true;setBusy(true);onBusy(true);setError('');void(async()=>{try{const response=await fetch(`/api/operations/wms/${cancel?'commands':'approvals'}`,{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify(pending.current)});const data=await response.json();if(!response.ok)throw Error(data.error);onSaved();}catch(cause){setError(cause instanceof Error?cause.message:'操作失败。');}finally{lock.current=false;setBusy(false);onBusy(false);}})();}}><fieldset disabled={busy} className="space-y-3"><p>{order.number} · 版本 {order.revision}</p>{!cancel&&order.lines.map((line,index)=>{const remaining=action==='TRANSFER_ORDER_SHIP'?line.quantity-line.shippedQty:line.shippedQty-line.receivedQty;return <label key={line.id} className="grid gap-1">{line.source.location.code} / {line.source.lot.lotCode} → {line.target.code} · 剩余 {remaining}<input type="number" min={0} max={remaining} step={1} aria-label={`调拨作业明细${index+1}数量`} value={quantities[line.id]??''} onChange={event=>{pending.current=null;setQuantities(current=>({...current,[line.id]:event.target.value}));}} className={cls}/></label>;})}<label className="grid gap-1">{cancel?'取消原因':'发运/签收凭据'}<input required aria-label="调拨作业依据" value={reference} onChange={event=>{pending.current=null;setReference(event.target.value);}} className={cls}/></label><Button type="submit">{cancel?'确认取消调拨':'提交调拨审批'}</Button></fieldset>{error&&<p role="alert" className="text-red-600">{error}</p>}</form>;
}
