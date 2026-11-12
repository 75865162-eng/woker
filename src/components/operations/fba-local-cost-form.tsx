"use client";
import { useRef, useState } from "react";
import type { FbaLocalPlansResult } from "@/lib/fba-local/service";
import { Button } from "@/components/ui/button";
type Plan = FbaLocalPlansResult["items"][number];
export function FbaLocalCostForm({ plan, workspaceId, onBusyChange, onSaved, ledger }: { plan: Plan; workspaceId: string; onBusyChange: (busy: boolean) => void; onSaved: () => void; ledger?: { fee?: Plan['fees'][number] } }) {
  const initial = ledger ? ledger.fee?.estimate : plan.costAllocation;
  const actualLocked = ledger ? !!ledger.fee?.bill : plan.costAllocation?.stage === "ACTUAL";
  const [reference,setReference]=useState(initial?.reference??"");
  const [amount,setAmount]=useState(initial?.amount??"");
  const [currency,setCurrency]=useState(initial?.currency??"");
  const [stage,setStage]=useState(initial?.stage??"ESTIMATE");
  const [method,setMethod]=useState(initial?.method??"QUANTITY");
  const [number,setNumber]=useState(''),[feeType,setFeeType]=useState('OCEAN'),[forwarder,setForwarder]=useState('');
  const [linkOrder,setLinkOrder]=useState(false);
  const [hierarchical,setHierarchical]=useState(!!initial?.hierarchy);
  const [boxShipments,setBoxShipments]=useState<Record<string,string>>(()=>Object.fromEntries(initial?.hierarchy?.shipments.flatMap(row=>row.boxes.map(box=>[box.number,row.shipmentId]))??[]));
  const idempotencyKey=useRef('');
  const [basis,setBasis]=useState<Record<string,Record<string,string>>>(()=>Object.fromEntries(plan.lines.map(line=>{
    const prior=initial?.lines.find(row=>row.lineId===line.id);
    return [line.id,prior?Object.fromEntries(Object.entries(prior).filter(([key,value])=>key.startsWith('unit')&&key!=='unitCost'&&key!=='unitCostRemainder'&&typeof value==='string').map(([key,value])=>[key,String(value)])):{}];
  })));
  const [busy,setBusy]=useState(false),[error,setError]=useState("");const lock=useRef(false);
  const fields=method==="CHARGEABLE_WEIGHT"?[["unitWeightKg","单位实际重（kg）"],["unitDimensionalWeightKg","单位体积重（kg）"]]:method==="VOLUME"?[["unitVolumeM3","单位体积（m³）"]]:method==="VALUE"?[["unitValue","单位货值（同费用币种）"]]:[];
  async function save(event:React.FormEvent){
    event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);onBusyChange(true);setError("");
    try{
      const hierarchy=hierarchical?{shipments:plan.shipments.filter(shipment=>plan.packing?.boxes.some(box=>boxShipments[box.number]===shipment.id)).map(shipment=>({shipmentId:shipment.id,boxes:plan.packing!.boxes.filter(box=>boxShipments[box.number]===shipment.id).map(box=>({number:box.number,items:box.items}))}))}:undefined;
      if(hierarchical&&(!plan.packing||plan.packing.boxes.some(box=>!boxShipments[box.number])))throw Error('请为每箱选择关联货件。');
      const costAllocation={reference,amount,currency,stage:ledger?(ledger.fee?'ACTUAL':'ESTIMATE'):stage,method,basis:plan.lines.map(line=>({lineId:line.id,...Object.fromEntries(fields.map(([key])=>[key,basis[line.id]?.[key]??""]))})),...(hierarchy?{hierarchy}:{})};
      if(!idempotencyKey.current)idempotencyKey.current=crypto.randomUUID();
      const payload=ledger ? ledger.fee ? {action:'CONFIRM_FORWARDER_BILL',forwarderBill:{feeId:ledger.fee.id,number,forwarder:linkOrder?plan.forwarderOrder!.forwarder:forwarder,...(linkOrder?{forwarderOrderId:plan.forwarderOrder!.id}:{}),idempotencyKey:idempotencyKey.current,allocation:costAllocation}} : {action:'CREATE_FEE_RECORD',feeRecord:{number,feeType,idempotencyKey:idempotencyKey.current,allocation:costAllocation}} : {action:'SAVE_COST_ALLOCATION',costAllocation};
      const response=await fetch('/api/operations/fba-local-plans',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({...payload,id:plan.id,expectedRevision:plan.revision})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'费用保存失败。');onSaved();
    }catch(cause){setError(cause instanceof Error?cause.message:'费用保存失败。');}
    finally{lock.current=false;setBusy(false);onBusyChange(false);}
  }
  return <form onSubmit={save} aria-label="头程费用分摊" className="space-y-4">
    <p className="text-sm text-muted">{ledger ? ledger.fee ? '确认后保留预估及实际账单，自动计算差异并生成待核算映射的调整草稿。实际账单不可覆盖。' : '独立归集每笔费用，保存后保留预估，后续录入货代实际账单对账。' : '按所选依据分摊到计划明细，金额保留六位小数并精确对平。预估可更新；实际账单确认后不可覆盖。'}此记录不代表付款、库存估值或总账过账。</p>
    {ledger&&<fieldset disabled={busy||actualLocked} className="flex flex-wrap gap-3"><label className="grid gap-1 text-sm">{ledger.fee?'货代账单号':'费用编号'}<input required aria-label={ledger.fee?'货代账单号':'费用编号'} value={number} onChange={event=>setNumber(event.target.value)} className="h-9 rounded border border-input bg-background px-2"/></label>{ledger.fee?<label className="grid gap-1 text-sm">货代<input required aria-label="货代" value={forwarder} onChange={event=>setForwarder(event.target.value)} className="h-9 rounded border border-input bg-background px-2"/></label>:<label className="grid gap-1 text-sm">费用类型<select aria-label="费用类型" value={feeType} onChange={event=>setFeeType(event.target.value)} className="h-9 rounded border border-input bg-background">{[['OCEAN','海运费'],['AIR','空运费'],['FUEL','燃油附加'],['CUSTOMS','报关费'],['CLEARANCE','清关费'],['INSURANCE','保险'],['TRUCKING','拖车费'],['OTHER','其他']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}</fieldset>}
    {ledger?.fee&&plan.forwarderOrder&&plan.forwarderOrder.status!=='CANCELLED'&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={linkOrder} disabled={busy||actualLocked} onChange={event=>{setLinkOrder(event.target.checked);if(event.target.checked)setForwarder(plan.forwarderOrder!.forwarder);}}/>关联委托单 {plan.forwarderOrder.number}（{plan.forwarderOrder.forwarder}）</label>}
    <fieldset disabled={busy || actualLocked} className="flex flex-wrap gap-3">{[["费用来源单号",reference,setReference],["费用金额",amount,setAmount],["币种",currency,setCurrency]].map(([label,value,setter])=><label key={String(label)} className="grid gap-1 text-sm">{String(label)}<input required aria-label={String(label)} value={String(value)} onChange={event=>(setter as (v:string)=>void)(event.target.value)} className="h-9 w-40 rounded border border-input bg-background px-2"/></label>)}
      {!ledger&&<label className="grid gap-1 text-sm">费用阶段<select aria-label="费用阶段" value={stage} onChange={event=>setStage(event.target.value as typeof stage)} className="h-9 rounded border border-input bg-background"><option value="ESTIMATE">预估</option><option value="ACTUAL">实际账单</option></select></label>}
      <label className="grid gap-1 text-sm">分摊方式<select aria-label="分摊方式" value={method} onChange={event=>setMethod(event.target.value as typeof method)} className="h-9 rounded border border-input bg-background"><option value="QUANTITY">数量</option><option value="CHARGEABLE_WEIGHT">计费重（实际重与体积重取大）</option><option value="VOLUME">体积</option><option value="VALUE">货值</option></select></label>
    </fieldset>
    <fieldset disabled={busy||actualLocked} className="space-y-2"><label className="flex gap-2 text-sm"><input type="checkbox" aria-label="按货件箱SKU分层分摊" checked={hierarchical} onChange={event=>setHierarchical(event.target.checked)}/>按货件 → 箱 → SKU 分层分摊（每层尾差独立对平）</label>{hierarchical&&(!plan.packing||!plan.shipments.length?<p className="text-sm text-muted">请先保存装箱资料并关联完整货件数量。</p>:plan.packing.boxes.map(box=><label key={box.number} className="flex items-center gap-2 text-sm">箱 {box.number}<select required aria-label={`箱${box.number}所属货件`} value={boxShipments[box.number]??''} onChange={event=>setBoxShipments(current=>({...current,[box.number]:event.target.value}))} className="h-9 rounded border border-input bg-background"><option value="">选择货件</option>{plan.shipments.map(shipment=><option key={shipment.id} value={shipment.id}>{shipment.spApiShipmentId}</option>)}</select></label>))}</fieldset>
    {fields.length>0&&plan.lines.map((line,index)=><fieldset key={line.id} disabled={busy || actualLocked} className="rounded border border-border p-3"><legend>明细 {index+1} · {line.stock?.locationCode} / {line.stock?.lotCode} · {line.quantity} 件</legend><div className="flex flex-wrap gap-3">{fields.map(([key,label])=><label key={key} className="grid gap-1 text-sm">{label}<input required aria-label={`明细${index+1}${label}`} inputMode="decimal" value={basis[line.id]?.[key]??""} onChange={event=>setBasis(current=>({...current,[line.id]:{...current[line.id],[key]:event.target.value}}))} className="h-9 w-40 rounded border border-input bg-background px-2"/></label>)}</div></fieldset>)}
    {actualLocked&&<p role="status" className="text-sm text-muted">实际账单已确认并锁定。</p>}{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}{!actualLocked&&<Button disabled={busy} type="submit">{ledger?ledger.fee?'确认账单并对账':'保存费用预估':'计算并保存费用草稿'}</Button>}
  </form>;
}
