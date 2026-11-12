'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { externalWorkflowSteps } from '@/lib/fba-local/external-operation-contract';
import type { FbaLocalPlansResult } from '@/lib/fba-local/service';
type Plan = FbaLocalPlansResult['items'][number];
const cls='h-9 rounded border border-border bg-background px-2 text-sm';
export function FbaExternalOperationRecords({plan,workspaceId,userId,canEdit,canReview,onSaved}:{plan:Plan;workspaceId:string;userId:string;canEdit:boolean;canReview:boolean;onSaved:()=>void}) {
  const [form,setForm]=useState({step:'PLAN',operationName:'',requestDigest:'',requestId:'',operationId:'',entityId:'',evidence:''});
  const [resolution,setResolution]=useState({result:'FAILED',operationId:'',entityId:'',evidence:''});
  const key=useRef(''), pending=useRef(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function send(action:string,externalOperation:unknown){
    if(pending.current)return; pending.current=true;setBusy(true);setError('');
    try{const response=await fetch('/api/operations/fba-local-plans',{method:'POST',headers:{'content-type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action,id:plan.id,expectedRevision:plan.revision,externalOperation})});const result=await response.json();if(!response.ok)throw Error(result.error??'操作登记失败。');key.current='';onSaved();}catch(cause){setError(cause instanceof Error?cause.message:'操作登记失败。');}finally{pending.current=false;setBusy(false);}
  }
  return <details className="space-y-2 rounded border border-border p-3"><summary className="cursor-pointer text-sm font-medium">外部操作未知结果与核实记录</summary><p className="text-xs text-muted">此处登记原操作的未知结果与人工独立核实依据。不会发送 Amazon 请求、启用重试或改变公司仓库存。需要提交或查询 Amazon 时，使用下方独立审批的外部执行草稿。</p>
    {canEdit&&plan.status!=='CANCELLED'&&<form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();if(!key.current)key.current=crypto.randomUUID();void send('REGISTER_EXTERNAL_UNCERTAINTY',{...form,idempotencyKey:key.current});}}>
      <select className={cls} aria-label="外部工作流步骤" value={form.step} onChange={event=>{key.current='';setForm({...form,step:event.target.value});}}>{externalWorkflowSteps.map(step=><option key={step}>{step}</option>)}</select>
      {(['operationName','requestDigest','requestId','operationId','entityId','evidence'] as const).map(field=><input key={field} className={cls} required={['operationName','requestDigest','evidence'].includes(field)} aria-label={`外部登记 ${field}`} placeholder={{operationName:'原操作名',requestDigest:'原请求 SHA-256',requestId:'Request ID（可空）',operationId:'Operation ID（可空）',entityId:'外部实体 ID（可空）',evidence:'原操作依据'}[field]} value={form[field]} onChange={event=>{key.current='';setForm({...form,[field]:event.target.value});}}/>)}<Button size="sm" disabled={busy}>登记未知结果</Button>
    </form>}
    {(plan.externalOperations??[]).map(row=><div key={row.id} className="space-y-1 border-t border-border py-2 text-xs"><p>{row.step} · {row.operationName} · {row.status} · API {row.apiVersion}</p><p>请求摘要 {row.requestDigest} · Operation {row.operationId??'未知'} · 实体 {row.entityId??'未知'}</p><p>原依据：{row.evidence}</p>{row.resolutionEvidence&&<p>独立核实：{row.resolutionEvidence}</p>}{row.status==='RESULT_UNKNOWN'&&row.createdBy!==userId&&canReview&&<form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();void send('RESOLVE_EXTERNAL_UNCERTAINTY',{recordId:row.id,...resolution});}}><select className={cls} aria-label="核实结果" value={resolution.result} onChange={event=>setResolution({...resolution,result:event.target.value})}><option value="FAILED">已核实失败</option><option value="SUCCEEDED">已核实成功</option></select>{(['operationId','entityId','evidence'] as const).map(field=><input key={field} required={field==='evidence'} aria-label={`核实 ${field}`} placeholder={field} className={cls} value={resolution[field]} onChange={event=>setResolution({...resolution,[field]:event.target.value})}/>)}<Button size="sm" disabled={busy}>保存独立核实</Button></form>}</div>)}{error&&<p role="alert" className="text-red-700">{error}</p>}
  </details>;
}
