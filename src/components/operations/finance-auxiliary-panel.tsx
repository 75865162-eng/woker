'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
type Catalog={id:string;code:string;name:string;typeId?:string;revision?:number;enabled?:boolean;isFixed?:boolean};
type Data={types:Catalog[];items:Catalog[];rules:Array<{id:string;subjectId:string;typeId:string;required:boolean}>;voucherTypes:Catalog[];assignments:Array<{lineNumber:number;typeId:string;itemId:string}>;profile:{voucherTypeId:string;evidence:string}|null;truncated?:Record<string,boolean>};
const empty:Data={types:[],items:[],rules:[],voucherTypes:[],assignments:[],profile:null};
const cls='h-9 min-w-0 rounded border border-border bg-background px-2 text-sm';
export function FinanceAuxiliaryPanel({bookId,vouchers,subjects,canCreate,canApprove,headers,onSaved}:{bookId:string;vouchers:Array<{id:string;status:string;kind:string;revision:number;sourceKey:string;lines:Array<{lineNumber:number;subjectId:string}>}>;subjects:Array<{id:string;code:string;name:string;leaf:boolean;enabled:boolean}>;canCreate:boolean;canApprove:boolean;headers:()=>Headers;onSaved:()=>Promise<unknown>}){
 const [data,setData]=useState<Data>(empty),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [code,setCode]=useState(''),[name,setName]=useState(''),[typeId,setTypeId]=useState(''),[subjectId,setSubjectId]=useState(''),[required,setRequired]=useState(true),[policyReference,setPolicyReference]=useState('');
 const [voucherId,setVoucherId]=useState(''),[voucherTypeId,setVoucherTypeId]=useState(''),[evidence,setEvidence]=useState(''),[assignments,setAssignments]=useState('[]');
 const load=useCallback(async()=>{
  const params=new URLSearchParams({bookId});if(voucherId)params.set('voucherId',voucherId);
  const response=await fetch(`/api/operations/finance-auxiliary?${params}`,{headers:headers(),cache:'no-store'});const result=await response.json();if(!response.ok)throw Error(result.error??'辅助核算读取失败。');return result as Data;
 },[bookId,voucherId,headers]);
 useEffect(()=>{let active=true;void load().then(result=>{if(active){setData(result);setAssignments(JSON.stringify(result.assignments.map(({lineNumber,typeId,itemId})=>({lineNumber,typeId,itemId})),null,2));setVoucherTypeId(result.profile?.voucherTypeId??'');setEvidence(result.profile?.evidence??'');}}).catch(cause=>{if(active)setError(String(cause));});return()=>{active=false;};},[load]);
 async function command(action:string,fields:Record<string,unknown>){setBusy(true);setError('');try{const response=await fetch('/api/operations/finance-auxiliary',{method:'POST',headers:headers(),body:JSON.stringify({action,bookId,...fields})});const result=await response.json();if(!response.ok)throw Error(result.error??'辅助核算保存失败。');setData(await load());await onSaved();}catch(cause){setError(cause instanceof Error?cause.message:'辅助核算保存失败。');}finally{setBusy(false);}}
 const selected=vouchers.find(row=>row.id===voucherId);
 return <details className="space-y-3 border-b border-border py-4"><summary className="cursor-pointer text-sm font-semibold">辅助核算与凭证类别</summary>
 <p className="text-xs text-muted">目标端定义类型、项目及科目规则。项目可改名、停用或删除未引用自定义项，系统项保留名称；必填项在审核和过账时检查，红字沿用原凭证维度。</p>
 {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 {canApprove&&<div className="grid gap-2 sm:grid-cols-3">
 <input aria-label="辅助定义编码" className={cls} value={code} onChange={e=>setCode(e.target.value)} placeholder="编码"/><input aria-label="辅助定义名称" className={cls} value={name} onChange={e=>setName(e.target.value)} placeholder="名称"/>
 <input aria-label="辅助制度依据" className={cls} value={policyReference} onChange={e=>setPolicyReference(e.target.value)} placeholder="目标端制度依据"/>
 <select aria-label="辅助类型" className={cls} value={typeId} onChange={e=>setTypeId(e.target.value)}><option value="">选择辅助类型</option>{data.types.map(row=><option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select>
 <select aria-label="辅助绑定科目" className={cls} value={subjectId} onChange={e=>setSubjectId(e.target.value)}><option value="">选择科目</option>{subjects.filter(row=>row.leaf&&row.enabled).map(row=><option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select>
 <label className="text-xs"><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)}/> 必填辅助项目</label>
 <Button size="sm" disabled={busy||!code||!name} onClick={()=>void command('create-type',{code,name})}>新增辅助类型</Button>
 <Button size="sm" disabled={busy||!code||!name||!typeId} onClick={()=>void command('create-item',{typeId,code,name})}>新增辅助项目</Button>
 <Button size="sm" disabled={busy||!typeId||!subjectId||!policyReference} onClick={()=>void command('configure-subject',{typeId,subjectId,required,policyReference})}>绑定科目辅助规则</Button>
 <Button size="sm" disabled={busy||!code||!name||!policyReference} onClick={()=>void command('create-voucher-type',{code,name,policyReference})}>新增凭证类别</Button>
 </div>}
 <ul className="space-y-1 text-xs">{data.items.map(row=><li key={row.id}>{data.types.find(type=>type.id===row.typeId)?.name} / {row.code} · {row.name} · 项目 ID {row.id} · 类型 ID {row.typeId} · {row.enabled===false?'已停用':'启用'}{canApprove&&<><Button size="sm" disabled={busy} onClick={()=>void command('update-item',{itemId:row.id,revision:row.revision,name:row.name,enabled:row.enabled===false})}>{row.enabled===false?'启用项目':'停用项目'}</Button><Button size="sm" disabled={busy||!name||row.isFixed} onClick={()=>void command('update-item',{itemId:row.id,revision:row.revision,name,enabled:row.enabled!==false})}>使用输入名称修改</Button><Button size="sm" disabled={busy||row.isFixed} onClick={()=>void command('delete-item',{itemId:row.id,revision:row.revision})}>删除未引用项目</Button></>}</li>)}</ul>
 <ul className="space-y-1 text-xs">{data.rules.map(row=><li key={row.id}>{subjects.find(subject=>subject.id===row.subjectId)?.code} → {data.types.find(type=>type.id===row.typeId)?.name} · {row.required?'必填':'选填'}</li>)}</ul>
 {canCreate&&<form className="grid gap-2 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();try{void command('annotate-voucher',{voucherId,revision:selected?.revision,assignments:JSON.parse(assignments),voucherTypeId:voucherTypeId||null,evidence});}catch{setError('辅助分录须为有效 JSON 数组。');}}}>
 <select aria-label="辅助核算凭证" className={cls} required value={voucherId} onChange={e=>setVoucherId(e.target.value)}><option value="">选择普通凭证草稿</option>{vouchers.filter(row=>row.status==='DRAFT'&&row.kind==='STANDARD').map(row=><option key={row.id} value={row.id}>{row.sourceKey} · revision {row.revision}</option>)}</select>
 <select aria-label="凭证类别" className={cls} value={voucherTypeId} onChange={e=>setVoucherTypeId(e.target.value)}><option value="">未分类</option>{data.voucherTypes.map(row=><option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select>
 <p className="text-xs text-muted sm:col-span-2">分录：{selected?.lines.map(row=>`${row.lineNumber}: ${subjects.find(subject=>subject.id===row.subjectId)?.code}`).join('；')}。每项填写 lineNumber、typeId、itemId。</p>
 <textarea aria-label="凭证辅助分录" className="min-h-24 rounded border border-border bg-background p-2 text-xs sm:col-span-2" required value={assignments} onChange={e=>setAssignments(e.target.value)}/>
 <input aria-label="辅助核算依据" className={cls} required maxLength={1000} value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="依据"/>
 <Button size="sm" disabled={busy||!voucherId||!evidence.trim()}>保存凭证辅助核算</Button>
 </form>}
 {Object.values(data.truncated??{}).some(Boolean)&&<p className="text-xs text-muted">当前仅显示部分定义，不能据此认定全部定义已加载。</p>}
 </details>;
}
