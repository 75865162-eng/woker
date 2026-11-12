"use client";
import {useRef,useState} from 'react';
import type {FbaLocalPlansResult} from '@/lib/fba-local/service';
import {Button} from '@/components/ui/button';
import {WorkbenchDialog} from '@/components/ui/workbench-dialog';
import {FbaTransportDetails} from './fba-transport-details';
type Plan=FbaLocalPlansResult['items'][number];
const labels:Record<string,string>={BOOKED:'已委托',IN_TRANSIT:'运输中',ARRIVED:'已抵达目的港/站',CLEARED:'已清关',DELIVERED:'货代已送达',CANCELLED:'已取消',DEPARTED:'已发运',NOTE:'补充记录',OCEAN:'海运',AIR:'空运',ROAD:'公路',RAIL:'铁路'};
export function FbaLocalTransport({plan,workspaceId,canEdit,disabled,onSaved}:{plan:Plan;workspaceId:string;canEdit:boolean;disabled:boolean;onSaved:()=>void}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
  const order=plan.forwarderOrder;
  const editable=canEdit&&plan.status!=='CANCELLED'&&!['DELIVERED','CANCELLED'].includes(order?.status??'');
  return <div className="space-y-2 border-b border-border px-3 py-2 text-sm" aria-label="货代委托与物流轨迹">
    <div className="flex items-center gap-3"><span>货代委托与物流轨迹</span>{editable&&<Button size="sm" variant="secondary" disabled={disabled||busy} onClick={()=>setOpen(true)}>{order?'追加物流节点':'新建货代委托'}</Button>}</div>
    {order?<><FbaTransportDetails key={order.id} order={order}/><p>{order.number} · {order.forwarder} · {order.channel} · {labels[order.mode]} · {labels[order.status]}</p><p className="text-xs text-muted">目的地址：{order.destination}</p>{(order.containerNumber||order.billOfLading||order.vesselOrFlight)&&<p className="text-xs text-muted">柜号 {order.containerNumber??'未提供'} · 提单 {order.billOfLading??'未提供'} · 船名航次/航班 {order.vesselOrFlight??'未提供'}</p>}
      <div className="text-xs text-muted">{([['截单',order.cutoffAt],['预计起运',order.departureEta],['预计到达',order.arrivalEta]] as const).map(([label,value])=>value?<p key={label}>{label}：{new Date(value).toISOString()}</p>:null)}</div>
      <p className="text-xs text-muted">人工录入的运输记录；货代送达不代表 Amazon 已收货。共 {order._count.events} 条，显示最近 50 条。</p>
      <ul className="space-y-1 text-xs">{order.events.map(event=><li key={event.id}>{new Date(event.occurredAt).toISOString()} · {labels[event.eventType]} · {event.location} · {event.evidence}</li>)}</ul>
    </>:<p className="text-xs text-muted">尚未建立运输委托；本批每计划关联一张整批运输委托单。</p>}
    <WorkbenchDialog open={open} title={order?'追加物流节点':'新建货代委托'} busy={busy} onClose={()=>setOpen(false)}>{open&&<TransportForm plan={plan} workspaceId={workspaceId} onBusyChange={setBusy} onSaved={()=>{setOpen(false);onSaved();}}/>}</WorkbenchDialog>
  </div>;
}
function TransportForm({plan,workspaceId,onBusyChange,onSaved}:{plan:Plan;workspaceId:string;onBusyChange:(v:boolean)=>void;onSaved:()=>void}) {
  const order=plan.forwarderOrder;
  const [values,setValues]=useState<Record<string,string>>({mode:'OCEAN',eventType:order?.status==='BOOKED'?'DEPARTED':order?.status==='IN_TRANSIT'?'ARRIVED':order?.status==='ARRIVED'?'CLEARED':'DELIVERED'});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false),key=useRef('');
  const options=order?order.status==='BOOKED'?['DEPARTED','NOTE']:order.status==='IN_TRANSIT'?['ARRIVED','DELIVERED','NOTE']:order.status==='ARRIVED'?['CLEARED','DELIVERED','NOTE']:['DELIVERED','NOTE']:['OCEAN','AIR','ROAD','RAIL'];
  const fields=order?[['occurredAt','发生时间','datetime-local',true],['location','节点地点','text',true],['evidence','凭据或来源说明','text',true]] as const:[['number','委托单号','text',true],['forwarder','货代','text',true],['channel','运输渠道','text',true],['destination','目的地址','text',true],['containerNumber','柜号','text',false],['billOfLading','提单号','text',false],['vesselOrFlight','船名航次/航班','text',false],['cutoffAt','截单时间','datetime-local',false],['departureEta','预计起运时间','datetime-local',false],['arrivalEta','预计到达时间','datetime-local',false]] as const;
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);onBusyChange(true);setError('');
    try {
      if(!key.current)key.current=crypto.randomUUID();
      const payload:Record<string,unknown>=Object.fromEntries(fields.map(([name,,type])=>[name,values[name]?type==='datetime-local'?new Date(values[name]).toISOString():values[name]:null]));
      payload[order?'eventType':'mode']=values[order?'eventType':'mode'];payload.idempotencyKey=key.current;
      const response=await fetch('/api/operations/fba-local-plans',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:order?'APPEND_TRACKING':'CREATE_FORWARDER_ORDER',id:plan.id,expectedRevision:plan.revision,[order?'trackingEvent':'forwarderOrder']:payload})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'运输资料保存失败。');onSaved();
    }catch(cause){setError(cause instanceof Error?cause.message:'保存失败。');}
    finally{lock.current=false;setBusy(false);onBusyChange(false);}
  }
  return <form onSubmit={submit} aria-label={order?'物流节点录入':'货代委托录入'} className="space-y-4"><p className="text-xs text-muted">时间按本机时区填写，保存后以 UTC 显示。记录须有实际来源；发运前必须完成装箱和公司仓全部出库。</p><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
    <label className="grid gap-1 text-sm">{order?'物流节点':'运输方式'}<select aria-label={order?'物流节点':'运输方式'} value={values[order?'eventType':'mode']} onChange={event=>setValues(current=>({...current,[order?'eventType':'mode']:event.target.value}))} className="h-9 rounded border border-input bg-background">{options.map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label>
    {fields.map(([name,label,type,required])=><label key={name} className="grid gap-1 text-sm">{label}{!required?'（选填）':''}<input required={required} aria-label={label} type={type} value={values[name]??''} maxLength={name==='evidence'?2000:300} onChange={event=>setValues(current=>({...current,[name]:event.target.value}))} className="h-9 rounded border border-input bg-background px-2"/></label>)}
  </fieldset>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}<Button disabled={busy} type="submit">{order?'保存物流节点':'保存货代委托'}</Button></form>;
}
