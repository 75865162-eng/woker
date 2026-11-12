"use client";
import {useRef,useState} from 'react';
import type {FbaLocalPlansResult} from '@/lib/fba-local/service';
import type {previewShipment} from '@/lib/fba-local/shipment-service';
import {Button} from '@/components/ui/button';
import {WorkbenchDialog} from '@/components/ui/workbench-dialog';
type Plan=FbaLocalPlansResult['items'][number];
type Preview=Awaited<ReturnType<typeof previewShipment>>;
export function FbaLocalShipmentLinks({plan,workspaceId,canEdit,disabled,onSaved}:{plan:Plan;workspaceId:string;canEdit:boolean;disabled:boolean;onSaved:()=>void}){
  const[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
  return <div aria-label="Amazon 货件关联" className="space-y-2 border-b border-border px-3 py-2 text-sm"><div className="flex items-center gap-3"><span>Amazon 货件关联</span>{canEdit&&plan.status!=='CANCELLED'&&plan.shipments.length<20&&<Button size="sm" variant="secondary" disabled={disabled||busy} onClick={()=>setOpen(true)}>关联已同步货件</Button>}</div>
    {plan.shipments.length===0?<p className="text-xs text-muted">尚未关联 Amazon 货件。关联只读取已发布的同步记录，不创建或修改 Amazon 货件。</p>:plan.shipments.map(shipment=><div key={shipment.id} className="space-y-1 rounded border border-border p-2"><p>{shipment.spApiShipmentId} · 入库计划 {shipment.spApiInboundPlanId} · 仓库 {shipment.warehouseId??'未观测'} · 来源状态 {shipment.sourceStatus??'未观测'}</p><p className="text-xs text-muted">观察时间 {new Date(shipment.capturedAt).toISOString()} · 核对依据 {shipment.mappingEvidence}</p><ul className="list-inside list-disc text-xs">{shipment.items.map(item=><li key={item.id}>本地明细 {plan.lines.findIndex(line=>line.id===item.planLineId)+1} ↔ {item.sellerSku}{item.fnsku?` / ${item.fnsku}`:''} · 申报 {item.quantity} 件</li>)}</ul></div>)}
    <p className="text-xs text-muted">申报数量、公司仓出库和 Amazon 收货分别记录。关联保留核对时的来源版本，不自动刷新。</p>
    <WorkbenchDialog open={open} title="关联已同步货件" busy={busy} onClose={()=>setOpen(false)}>{open&&<LinkForm plan={plan} workspaceId={workspaceId} onBusy={setBusy} onSaved={()=>{setOpen(false);onSaved();}}/>}</WorkbenchDialog>
  </div>;
}
function LinkForm({plan,workspaceId,onBusy,onSaved}:{plan:Plan;workspaceId:string;onBusy:(value:boolean)=>void;onSaved:()=>void}){
  const[id,setId]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[evidence,setEvidence]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const[mappings,setMappings]=useState<{observationId:string;planLineId:string;quantity:string}[]>([]);
  const lock=useRef(false),key=useRef('');
  async function send(action:string,shipmentLink:unknown){const response=await fetch('/api/operations/fba-local-plans',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action,id:plan.id,expectedRevision:plan.revision,shipmentLink})});const value=await response.json();if(!response.ok)throw Error(value.error||'货件关联失败。');return value.item;}
  async function perform(save:boolean){
    if(lock.current)return;lock.current=true;setBusy(true);onBusy(true);setError('');
    try{
      if(save&&preview){if(!key.current)key.current=crypto.randomUUID();await send('LINK_AMAZON_SHIPMENT',{shipmentId:preview.spApiShipmentId,sourceRunId:preview.sourceRunId,observationId:preview.observationId,sourceDigest:preview.sourceDigest,mappingEvidence:evidence,idempotencyKey:key.current,mappings:mappings.map(row=>({...row,quantity:Number(row.quantity)}))});onSaved();}
      else{const result:Preview=await send('PREVIEW_SHIPMENT_LINK',{shipmentId:id});setPreview(result);setMappings(result.items.map(item=>({observationId:item.id,planLineId:'',quantity:String(item.declaredQuantity)})));}
    }catch(cause){setError(cause instanceof Error?cause.message:'读取失败。');}
    finally{lock.current=false;setBusy(false);onBusy(false);}
  }
  return <form aria-label="货件明细映射" onSubmit={event=>{event.preventDefault();void perform(!!preview);}} className="space-y-4">
    {!preview?<label className="grid gap-1 text-sm">Amazon 货件 ID<input required aria-label="Amazon 货件 ID" value={id} disabled={busy} onChange={event=>setId(event.target.value)} className="h-9 rounded border border-input bg-background px-2"/></label>:<>
      <p>{preview.spApiShipmentId} · {preview.warehouseId??'仓库未观测'} · {preview.items.length} 条来源商品行</p><p className="text-xs text-muted">请逐行核对商品与批次。相同 Seller SKU 的不同来源行不能合并；一条来源行可拆给多个本地库存明细。</p>
      {mappings.map((mapping,index)=>{const source=preview.items.find(item=>item.id===mapping.observationId)!;return <fieldset key={index} disabled={busy} className="space-y-2 rounded border border-border p-2"><legend>{source.sellerSku} / {source.fnsku??'FNSKU 未观测'} · 来源申报 {source.declaredQuantity} 件</legend><label className="grid gap-1">本地库存明细<select required aria-label={`映射${index+1}本地明细`} value={mapping.planLineId} onChange={event=>setMappings(rows=>rows.map((row,i)=>i===index?{...row,planLineId:event.target.value}:row))} className="h-9 rounded border border-input bg-background"><option value="">请选择</option>{plan.lines.map((line,i)=><option key={line.id} value={line.id}>{i+1} · {line.stock?.warehouseCode} / {line.stock?.locationCode} / {line.stock?.lotCode} · 计划 {line.quantity} 件</option>)}</select></label><label>映射数量<input required type="number" min="1" step="1" aria-label={`映射${index+1}数量`} value={mapping.quantity} onChange={event=>setMappings(rows=>rows.map((row,i)=>i===index?{...row,quantity:event.target.value}:row))} className="ml-2 h-9 w-24 rounded border border-input bg-background px-2"/></label><Button type="button" size="sm" variant="secondary" onClick={()=>setMappings(rows=>[...rows,{observationId:mapping.observationId,planLineId:'',quantity:''}])}>拆分此来源行</Button>{mappings.filter(row=>row.observationId===mapping.observationId).length>1&&<Button type="button" size="sm" variant="secondary" onClick={()=>setMappings(rows=>rows.filter((_,i)=>i!==index))}>移除此拆分</Button>}</fieldset>;})}
      <label className="grid gap-1">人工核对依据<input required aria-label="人工核对依据" maxLength={2000} value={evidence} onChange={event=>setEvidence(event.target.value)} className="h-9 rounded border border-input bg-background px-2"/></label>
    </>}{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}<div className="flex gap-2"><Button disabled={busy} type="submit">{preview?'保存货件关联':'读取已同步货件'}</Button>{preview&&<Button type="button" variant="secondary" disabled={busy} onClick={()=>{setPreview(null);setMappings([]);key.current='';}}>重新选择来源</Button>}</div>
  </form>;
}
