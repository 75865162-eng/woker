"use client";

import { useMemo, useState } from 'react';
import { WorkbenchPageTemplate } from '@/components/templates/page-templates';
import { Button } from '@/components/ui/button';
import { categories, quoteReferenceFba, referenceModel, type ReferenceFee, type ReferenceQuote } from '@/lib/ext/fba-reference';
import { canonicalMeasurement, displayMeasurement, weightUnits, dimensionUnits, type WeightUnit, type DimensionUnit } from '@/lib/ext/calculator-units';
import { FbaStorageReference } from './fba-storage-reference';
import { Kpis, Notice, Section, Table, extPost, money, useExt } from './kit';

type Scheme = { id: string; name: string; kind: string; currency: string; revision: number; inputs: Record<string, unknown>; result: Record<string, unknown>; createdAt: string };
const initial = () => ({
  rateModel: referenceModel, category: '服装和配饰',
  date: new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),
  price:'', weightLb:'', lengthIn:'', widthIn:'', heightIn:'',
  utilizationWeeks:'', utilizationExempt:'false', ageDays:'', supply30:'', supply90:'', lowExempt:'false',
  split:'', defect:'false', manual:'false', recoveryValue:'', shippedUnits:'', returnedUnits:'', awdRegion:'',
});
const requiredFields = new Set(['price', 'weightLb', 'lengthIn', 'widthIn', 'heightIn']);
const inputClass = 'focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 h-9 w-full min-w-0 rounded border border-border bg-surface px-2 text-sm text-foreground placeholder:text-muted';
const yesNo = [{value:'false',label:'否'},{value:'true',label:'是'}];

function pendingFeeHint(fee: ReferenceFee, form: ReturnType<typeof initial>, quote: ReferenceQuote): string {
  const missing = (fields: Array<[keyof typeof form, string]>) => fields.filter(([key])=>!form[key].trim()).map(([,label])=>`「${label}」`);
  const fill = (fields: Array<[keyof typeof form, string]>, location: string) => {
    const labels=missing(fields);
    return labels.length ? `请在${location}填写${labels.join('、')}，即可计算。` : '';
  };
  const datedFees = ['shipping','fuel','delivery','storageBase','utilization','aged','low','return','returnTotal','removal','disposal','liquidation','recovery'];
  if (datedFees.includes(fee.id) && (form.date<'2026-01-15'||form.date>'2027-01-14')) return '需补充当天适用的费率表；当前日期超出已有费率覆盖范围，填写商品参数无法得到金额。';
  switch (fee.id) {
    case 'shipping': case 'fuel': case 'delivery':
      return '需补充适用的普通商品配送费率，才能计算配送及燃油费用。';
    case 'utilization':
      return fill([['utilizationWeeks','仓储利用率（周）']], '“仓储与库存”中') || '请核对「符合利用率附加费豁免」及适用费率。';
    case 'aged':
      return fill([['ageDays','库龄（天）']], '“仓储与库存”中') || '需确认所选品类在 271–365 天的超龄费豁免规则；现有说明冲突，补填参数无法解决。';
    case 'low':
      if (quote.sizeTier==='超大件') return '需补充超大件低库存水平费率；已有费率表未列该尺寸分段。';
      return fill([['supply30','短期供货天数（30 天口径）'],['supply90','长期供货天数（90 天口径）']], '“仓储与库存”中') || '请核对供货天数及「符合低库存费豁免」。';
    case 'returnTotal': {
      const clothing = ['服装和配饰','鞋靴'].includes(form.category);
      const fields: Array<[keyof typeof form,string]> = clothing ? [['returnedUnits','当月退货件数']] : [['shippedUnits','当月配送件数'],['returnedUnits','当月退货件数']];
      const hint=fill(fields, '“入仓、退货、清货与 AWD 场景参数”中');
      if (!clothing&&fee.note.includes('未提供分类阈值')) return `${hint.replace('，即可计算。','。')}还需确认所选品类的退货率阈值，已有费率表未提供。`;
      return hint || '需确认所选品类的退货率阈值；已有费率表未提供该分类阈值。';
    }
    case 'awdStorage': return '请在“入仓、退货、清货与 AWD 场景参数”中选择「AWD 仓储区域」，即可计算。';
    case 'recovery': {
      const hint=fill([['recoveryValue','清货回收价值（USD / 件）']], '“入仓、退货、清货与 AWD 场景参数”中');
      const rule=quote.sizeTier==='小号大件'?'还需确认小号大件的清货计费归类，现有费率表未明确。':'';
      return rule ? `${hint.replace('，即可计算。','。')}${rule}` : hint;
    }
    case 'removal': case 'disposal': case 'liquidation':
      return '需确认小号大件的移除 / 弃置 / 清货计费归类；现有费率表未明确，补填重量无法解决。';
    case 'handling': return '需确认该商品的特大号处理费具体档位；现有费率表只提供 $17 起，无法由尺寸确定精确金额。';
    case 'referral': case 'refund': return '需确认艺术品分段佣金的累进规则，才能计算佣金及退款管理费；补填售价无法解决。';
    case 'inbound':
      if (!form.split) return '请在“入仓、退货、清货与 AWD 场景参数”中选择「入仓拆分方式」，即可查看费用区间。';
      if (form.split==='optimized') return '需确认满足 ≥5 个相同纸箱等优化拆分资格；满足时参考费用为 $0.00。';
      return '还需确认目的运营中心的入库配置报价；本页所选拆分方式仅提供区间或缺少适用档位，无法得到精确金额。';
    default: return '需补充该费用的适用费率规则；当前参数不足以得到金额。';
  }
}

export function CalculatorsWorkbench() {
  const [form,setForm]=useState(initial);
  const [weightUnit,setWeightUnit]=useState<WeightUnit>('lb');
  const [dimensionUnit,setDimensionUnit]=useState<DimensionUnit>('in');
  const [measurementDrafts,setMeasurementDrafts]=useState<Record<string,{value:string;canonical:string;unit:string}>>({});
  const [name,setName]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [history,setHistory]=useState<Scheme|null>(null);
  const {data,error:loadError,loading,reload}=useExt<{items:Scheme[]}>('calc-schemes');
  const calculation=useMemo(()=>{
    if (['price','weightLb','lengthIn','widthIn','heightIn'].some(k=>!form[k as keyof typeof form].trim())) return {result:null,error:''};
    try {return {result:quoteReferenceFba(form),offPeak:quoteReferenceFba(form,'offPeak'),peak:quoteReferenceFba(form,'peak'),error:''};}
    catch(cause) {return {result:null,error:cause instanceof Error?cause.message:'请检查输入。'};}
  },[form]);
  const result=calculation.result;
  const set=(key:keyof typeof form)=>(value:string)=>{setForm(current=>({...current,[key]:value}));setNotice('');};
  const field=(key:keyof typeof form,label:string,hint?:string)=><label key={key} className="grid min-w-0 gap-1 text-xs">
    <span className="text-muted">{label}</span>
    <input className={inputClass} type="number" required={requiredFields.has(key)} placeholder={requiredFields.has(key)?'必填项':undefined} value={form[key]} onChange={event=>set(key)(event.target.value)}/>
    {hint&&<span className="text-label text-muted">{hint}</span>}
  </label>;
  const measurement=(key:'weightLb'|'lengthIn'|'widthIn'|'heightIn',label:string,hint?:string)=>{
    const isWeight=key==='weightLb';
    const unit=isWeight?weightUnit:dimensionUnit;
    const units=isWeight?weightUnits:dimensionUnits;
    const draft=measurementDrafts[key];
    const value=draft?.unit===unit&&draft.canonical===form[key]?draft.value:displayMeasurement(form[key],unit);
    return <div key={key} className="grid min-w-0 content-start gap-1 text-xs">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-1">
        <label className="text-muted" htmlFor={`calculator-${key}`}>{label}（{unit}）</label>
        <div role="group" aria-label={isWeight?'重量单位':`${label}单位（长宽高同步）`} className="inline-flex rounded border border-border bg-surface p-0.5">
          {units.map(option=><button key={option} type="button" aria-pressed={unit===option} className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${unit===option?'border-brand bg-brand text-white shadow-sm':'border-transparent bg-surface text-brand hover:border-brand hover:bg-surface-muted'}`} onClick={()=>isWeight?setWeightUnit(option as WeightUnit):setDimensionUnit(option as DimensionUnit)}>{option}</button>)}
        </div>
      </div>
      <input id={`calculator-${key}`} className={inputClass} type="number" step="any" required placeholder="必填项" value={value} onChange={event=>{
        const value=event.target.value;
        const canonical=canonicalMeasurement(value,unit);
        setMeasurementDrafts(current=>({...current,[key]:{value,canonical,unit}}));
        set(key)(canonical);
      }}/>
      {hint&&<span className="text-label text-muted">{hint}</span>}
    </div>;
  };
  const select=(key:keyof typeof form,label:string,options=yesNo)=><label key={key} className="grid min-w-0 gap-1 text-xs">
    <span className="text-muted">{label}</span>
    <select className={inputClass} value={form[key]} onChange={event=>set(key)(event.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
  </label>;
  async function save() {
    if (!name.trim()||!result) {setError('填写方案名称及完整商品参数后保存。');return;}
    setBusy(true);setError('');
    try {await extPost('save-calc-scheme',{name,kind:'FBA_FEE',marketplace:'US',currency:'USD',inputs:form});setNotice('测算方案已保存。');setName('');await reload();}
    catch(cause) {setError(cause instanceof Error?cause.message:'保存失败。');}
    finally {setBusy(false);}
  }
  async function remove(row:Scheme) {
    setBusy(true);setError('');
    try {await extPost('delete-calc-scheme',{id:row.id,revision:row.revision});setNotice('方案已删除。');await reload();}
    catch(cause) {setError(cause instanceof Error?cause.message:'删除失败。');}
    finally {setBusy(false);}
  }
  function load(row:Scheme) {
    if(row.inputs.rateModel!==referenceModel) {setHistory(row);setNotice('正在查看历史基线方案快照，未套用新费率。');return;}
    const next=initial();
    for (const key of Object.keys(next) as Array<keyof typeof next>) if(key!=='date'&&row.inputs[key]!==undefined) next[key]=String(row.inputs[key]);
    setMeasurementDrafts({});setForm(next);setName(row.name);setNotice('已载入方案参数，按当天费率自动测算。');setHistory(null);
  }
  return <WorkbenchPageTemplate context={<Notice error={error||calculation.error||loadError} notice={notice}/>} main={<div className="space-y-5">
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div id="fba-inputs" className="space-y-5 scroll-mt-6 rounded-lg border border-border p-4">
        <Section title="商品参数 · 输入即测算" description="美国站 · USD。先选品类，填写售价、包装三边及实际重量；按当天日期自动识别尺寸分段与淡旺季。">
          <div className="grid gap-3 sm:grid-cols-2">
            {select('category','商品品类',categories.map(c=>({value:c,label:c})))}
            {field('price','商品售价（USD）')}{measurement('weightLb','实际单件重量','1 lb = 16 oz = 0.45359237 kg；不必自行计算体积重')}
            {measurement('lengthIn','包装长')}{measurement('widthIn','包装宽')}{measurement('heightIn','包装高','三边单位同步切换；1 in = 2.54 cm')}
          </div>
        </Section>
        <Section title="仓储与库存" description="留空的因素显示待补充；月度仓储按单件持有整月估算，实际账单按日均库存。">
          <div className="grid gap-3 sm:grid-cols-2">
            {field('utilizationWeeks','仓储利用率（周）')}{select('utilizationExempt','符合利用率附加费豁免')}
            {field('ageDays','库龄（天）')}{field('supply30','短期供货天数（30 天口径）')}{field('supply90','长期供货天数（90 天口径）')}
            {select('lowExempt','符合低库存费豁免')}
          </div>
          <p className="text-xs text-muted">利用率豁免：新卖家、个人卖家或日均库存 ≤25 ft³。低库存豁免：食品、新卖家首年、新品入仓优惠期或 AWD 自动补货占比 ≥70%，请先确认资格。</p>
        </Section>
        <details className="rounded-lg border border-border bg-surface p-3 shadow-sm open:border-brand open:ring-1 open:ring-brand/20"><summary className="cursor-pointer rounded text-sm font-medium text-brand hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">入仓、退货、清货与 AWD 场景参数</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
          {select('split','入仓拆分方式',[{value:'',label:'请选择'},{value:'single',label:'单点入仓'},{value:'partial',label:'部分拆分（2–3 地点）'},{value:'optimized',label:'优化拆分（≥5 个相同纸箱）'}])}
          {select('defect','存在入库缺陷')}{select('manual','需要人工处理')}
          {field('shippedUnits','当月配送件数')}{field('returnedUnits','当月退货件数')}{field('recoveryValue','清货回收价值（USD / 件）')}
          {select('awdRegion','AWD 仓储区域',[{value:'',label:'未选用'},{value:'west',label:'美西'},{value:'east',label:'东部 / 南部'}])}
        </div></details>
      </div>
      <div className="space-y-4 xl:sticky xl:top-4" aria-live="polite" aria-atomic="false">
        {!result?<div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">填写售价、包装长宽高和实际重量后，费用将自动显示。仓储与退货等因素可按需补充。</div>:<>
          <Kpis items={[
            {label:'尺寸分段',value:result.sizeTier},{label:'计费重（lb）',value:result.weightLb.toFixed(3)},
            {label:'体积（ft³）',value:result.cubicFeet.toFixed(4)},{label:'配送费率期',value:result.period},
          ]}/>
          {result.warnings.map(w=><p key={w} className="rounded border border-border bg-background p-3 text-xs text-muted">{w}</p>)}
          <Section title="关键费用 · 淡旺季对比" description="配送：淡季 2026-01-15–10-14，旺季 2026-10-15–2027-01-14；仓储：淡季 1–9 月，旺季 10–12 月；人工处理：淡季 1–10 月，旺季 11–12 月。其他费用两列相同表示无季节差异。各场景费用不相加。">
            <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-border">
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 border-b border-border bg-surface p-3 text-xs font-semibold text-foreground">
                <span>费用名称</span><span className="text-right">淡季费用</span><span className="text-right">旺季费用</span>
              </div>
              {[...result.fees.filter(fee=>fee.id!=='handling'),...result.fees.filter(fee=>fee.id==='handling')].map(fee=>{
                const offPeak=calculation.offPeak?.fees.find(item=>item.id===fee.id)??fee;
                const peak=calculation.peak?.fees.find(item=>item.id===fee.id)??fee;
                const pending=offPeak.amount===null||peak.amount===null;
                return <div key={fee.id} className="border-b border-border p-3 last:border-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-start gap-2">
                    <span className="text-sm font-medium">{fee.label}</span>
                    <span className="text-right text-sm font-semibold tabular-nums">{offPeak.amount===null?'待确认':`$${money(offPeak.amount)}`}</span>
                    <span className="text-right text-sm font-semibold tabular-nums">{peak.amount===null?'待确认':`$${money(peak.amount)}`}</span>
                  </div>
                  {pending&&<p className="mt-1 text-xs text-danger-ink">{pendingFeeHint(fee,form,result)}</p>}
                  <p className="mt-1 text-xs text-muted">{fee.unit} · {offPeak.note===peak.note?fee.note:`淡季：${offPeak.note} 旺季：${peak.note}`}</p>
                </div>;
              })}
            </div>
          </Section>
          <div className="flex flex-wrap gap-2"><input aria-label="方案名称" className={`${inputClass} flex-1`} placeholder="方案名称" value={name} onChange={e=>setName(e.target.value)}/><Button size="sm" disabled={busy||!name.trim()} onClick={()=>void save()}>保存方案</Button></div>
        </>}
        <p className="text-xs text-muted">依据提供的 2026 费用手册计算；不代表已核验的 Amazon 账单。2027 新结构仅在手册中展示，不套用旧公式。</p>
      </div>
    </div>
    <FbaStorageReference/>
    <div id="fba-schemes" className="scroll-mt-6"><Section title="已保存方案" description="保留入参、日期与结果快照；历史基线方案仅查看，不冒充新口径结果。">
      <Table rows={data?.items??[]} empty={loading?'正在读取方案…':'暂无保存方案。'} columns={[
        {key:'name',label:'方案'},{key:'kind',label:'口径',render:row=>row.inputs.rateModel===referenceModel?'2026 参考手册':'历史基线'},
        {key:'currency',label:'币种'},{key:'createdAt',label:'保存时间',render:row=>row.createdAt.slice(0,10)},
        {key:'ops',label:'操作',render:row=><div className="flex gap-1"><Button size="sm" variant="secondary" className="text-brand hover:border-brand" disabled={busy} onClick={()=>load(row)}>查看 / 载入</Button><Button size="sm" variant="secondary" className="text-danger-ink hover:border-danger hover:bg-danger-soft" disabled={busy} onClick={()=>void remove(row)}>删除</Button></div>},
      ]}/>
      {history&&<details open className="mt-3 rounded border border-border p-3"><summary className="cursor-pointer text-sm text-brand hover:text-brand-dark">{history.name} · 历史快照（{history.currency}）</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({inputs:history.inputs,result:history.result},null,2)}</pre></details>}
    </Section></div>
  </div>}/>;
}
