"use client";
import { FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WmsCommandInput, WmsCommandPayload } from "@/lib/wms/contracts";

import type { ReservationStockContext, WmsLocationContext } from "@/lib/wms/reservation-view";
import { WmsApprovalDetails, type ApprovalTransferContext } from "./wms-approval-details";

type Approval = {conversionReversal?:Parameters<typeof WmsApprovalDetails>[0]["conversionReversal"];consumable?:import("@/lib/wms/consumable-view").ConsumableContext|null;conversionTarget?:{lotCode:string;sku:string;productRecordId:string}|null;transferOrder?:ApprovalTransferContext|null; id: string; revision: number; action: string; status: string; requestedBy: string; command: WmsCommandInput; stock: ReservationStockContext | null; targetLocation: WmsLocationContext | null };
const actions = ["RECEIVE", "INSPECT", "PUTAWAY", "RESERVE", "TRANSFER", "PICK", "UNPICK", "DISPATCH", "RELEASE", "CANCEL"] as const;
const labels = ["收货", "质检", "上架", "预占", "调拨", "拣货", "取消拣货", "出库", "释放预占", "取消草稿"];
export function WmsCommandPanel({ workspaceId }: { workspaceId: string }) {
 const [action,setAction]=useState<typeof actions[number]>("RECEIVE");
 const [aggregateId,setAggregateId]=useState("");const [revision,setRevision]=useState("1");
 const [lineId,setLineId]=useState("");const [quantity,setQuantity]=useState("1");
 const [rejected,setRejected]=useState("0");const [locationId,setLocationId]=useState("");const [number,setNumber]=useState("");
 const [notice,setNotice]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const pending = useRef<{ fingerprint: string; command: WmsCommandInput } | null>(null);
 const inFlight = useRef(false);
 const [approvals,setApprovals]=useState<Approval[]>([]);
 async function api(path:string,body?:unknown) {
  const response=await fetch(`/api/operations/wms/${path}`,{method:body?"POST":"GET",headers:{"content-type":"application/json","x-workspace-id":workspaceId},...(body?{body:JSON.stringify(body)}:{}),cache:"no-store"});
  const result=await response.json();if(!response.ok)throw Error(result.error || "操作失败");return result;
 }
 async function refresh() { const result=await api(`approvals?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`);setApprovals(result.items); }
 async function perform(fn:()=>Promise<void>) {if(inFlight.current)return;inFlight.current=true;setBusy(true);setError("");setNotice("");try{await fn();}catch(cause){setError(cause instanceof Error?cause.message:"操作失败");}finally{inFlight.current=false;setBusy(false);}}
 async function submit(event:FormEvent) {
  event.preventDefault();await perform(async()=>{
   let payload:WmsCommandPayload;
   if(action==="CANCEL")payload={action};
   else if(action==="RESERVE")payload={action,number,quantity:Number(quantity)};
   else if(action==="TRANSFER")payload={action,targetLocationId:locationId,quantity:Number(quantity)};
   else if(action==="INSPECT")payload={action,lines:[{lineId,acceptedQty:Number(quantity),rejectedQty:Number(rejected)}]};
   else if(action==="PUTAWAY")payload={action,lines:[{lineId,locationId,quantity:Number(quantity)}]};
   else if(action==="RECEIVE")payload={action,lines:[{lineId,quantity:Number(quantity)}]};
   else payload={action,quantity:Number(quantity)};
   const request={workspaceId,aggregateId,expectedRevision:Number(revision),payload};
   const fingerprint=JSON.stringify(request);
   if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,command:{...request,idempotencyKey:crypto.randomUUID()}};
   const command=pending.current.command;
   if(["PICK","UNPICK","CANCEL"].includes(action)) {const result=await api("commands",command);setNotice(`已完成，版本 ${result.item.revision}`);}
   else {await api("approvals",command);setNotice("已申请，须另一名有审批权限的成员核对并批准后执行。");}
   await refresh();
  });
 }
 const inputClass="rounded border border-border bg-background px-2 py-1.5 text-sm";
 return <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
  <h2 className="font-semibold">库存作业与审批</h2>
  <p className="text-sm text-muted-foreground">按当前单据/余额版本提交。收货、质检、上架、预占、调拨、释放和出库均需独立审批；批准后由申请人执行。</p>
  <form aria-label="按编号库存作业" onSubmit={submit} onChange={()=>{pending.current=null;}}><fieldset disabled={busy} className="flex flex-wrap items-end gap-2">
   <span className="text-xs text-muted-foreground">当前工作区：{workspaceId}</span>
   <label className="grid gap-1 text-xs">动作<select aria-label="动作" className={inputClass} value={action} onChange={e=>setAction(e.target.value as typeof action)}>{actions.map((value,i)=><option key={value} value={value}>{labels[i]}</option>)}</select></label>
   <label className="grid gap-1 text-xs">{["RESERVE","TRANSFER"].includes(action)?"余额 ID":"单据 ID"}<input className={inputClass} value={aggregateId} onChange={e=>setAggregateId(e.target.value)} required/></label>
   <label className="grid gap-1 text-xs">当前版本<input className={inputClass} type="number" min={1} value={revision} onChange={e=>setRevision(e.target.value)} required/></label>
   {["RECEIVE","INSPECT","PUTAWAY"].includes(action)&&<label className="grid gap-1 text-xs">收货明细 ID<input className={inputClass} value={lineId} onChange={e=>setLineId(e.target.value)} required/></label>}
   {action!=="CANCEL"&&<label className="grid gap-1 text-xs">{action==="INSPECT"?"合格数量":"数量"}<input className={inputClass} type="number" min={action==="INSPECT"?0:1} step={1} value={quantity} onChange={e=>setQuantity(e.target.value)} required/></label>}
   {action==="INSPECT"&&<label className="grid gap-1 text-xs">拒收数量<input className={inputClass} type="number" min={0} step={1} value={rejected} onChange={e=>setRejected(e.target.value)} required/></label>}
   {["PUTAWAY","TRANSFER"].includes(action)&&<label className="grid gap-1 text-xs">目标存储库位 ID<input className={inputClass} value={locationId} onChange={e=>setLocationId(e.target.value)} required/></label>}
   {action==="RESERVE"&&<label className="grid gap-1 text-xs">预占单号<input className={inputClass} value={number} onChange={e=>setNumber(e.target.value)} required/></label>}
   <Button type="submit" disabled={busy}>提交作业</Button>
   <Button type="button" variant="secondary" disabled={busy} onClick={()=>void perform(refresh)}>读取审批</Button>
  </fieldset></form>
  {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  <div className="space-y-2">{approvals.map(row=><div className="rounded border border-border p-3 text-sm" key={row.id}>
   <p>{row.action} · {row.status} · 申请人 {row.requestedBy}</p>
   <WmsApprovalDetails conversionReversal={row.conversionReversal} consumable={row.consumable} conversionTarget={row.conversionTarget} transferOrder={row.transferOrder} command={row.command} stock={row.stock} targetLocation={row.targetLocation} />
   <div className="flex gap-2">{row.status==="PENDING"&&<><Button size="sm" disabled={busy} onClick={()=>void perform(async()=>{await api("approvals",{workspaceId,approvalId:row.id,revision:row.revision,decision:"APPROVE"});await refresh();})}>核对后批准</Button><Button size="sm" variant="secondary" disabled={busy} onClick={()=>void perform(async()=>{await api("approvals",{workspaceId,approvalId:row.id,revision:row.revision,decision:"REJECT"});await refresh();})}>拒绝</Button></>}
   {(row.status==="APPROVED"||row.status==="CONSUMED")&&<Button size="sm" disabled={busy} onClick={()=>void perform(async()=>{const result=await api("commands",{...row.command,approvalId:row.id});setNotice(`已完成，单据 ${result.item.aggregateId}，版本 ${result.item.revision}`);await refresh();})}>{row.status==="CONSUMED"?"回读执行结果":"执行已批准作业"}</Button>}</div>
  </div>)}</div>
 </section>;
}
