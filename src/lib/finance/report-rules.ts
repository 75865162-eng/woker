import {evaluateReportFormula,reportFormulaReferences,validateReportFormula} from './report-formula';
import { WmsError } from '@/lib/wms/contracts';
import { requireText, strictKeys } from '@/lib/wms/rules';
import { amountUnits, unitsAmount } from './open-item-rules';
export type ReportRow = { code:string; label:string; metric:'OPENING'|'DEBIT'|'CREDIT'|'CLOSING'|'CALCULATED'; formula?:string; factor:'1'|'-1'; subjectIds:string[] };
export type ReportDefinition = { rows: ReportRow[]; closing: { subjectIds:string[]; destinationSubjectId:string } | null };
function ids(raw:unknown){if(!Array.isArray(raw)||!raw.length||raw.length>200||new Set(raw).size!==raw.length)throw new WmsError('科目清单须非空、无重复且最多 200 项。',400);return raw.map(value=>requireText(value,'科目 ID'));}
export function parseReportDefinition(raw:unknown):ReportDefinition{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsError('报表定义无效。',400);
  const input=raw as Record<string,unknown>;strictKeys(input,['rows','closing']);
  if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>100)throw new WmsError('报表须有 1 至 100 行。',400);
  const codes=new Set<string>();
  const rows=input.rows.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsError('报表行无效。',400);const row=raw as Record<string,unknown>;if(row.formula!=null){strictKeys(row,['code','label','formula']);const code=requireText(row.code,'报表行编码',40);if(codes.has(code)||!/^[-A-Za-z0-9_.]+$/.test(code))throw new WmsError('公式行编码须唯一且为英文数字/._-。',400);codes.add(code);const formula=requireText(row.formula,'报表公式',500);validateReportFormula(formula);return {code,label:requireText(row.label,'报表行名称',120),metric:'CALCULATED' as const,factor:'1' as const,subjectIds:[],formula};}strictKeys(row,['code','label','metric','factor','subjectIds']);const code=requireText(row.code,'报表行编码',40);if(codes.has(code)||!['OPENING','DEBIT','CREDIT','CLOSING'].includes(String(row.metric))||(row.factor!=='1'&&row.factor!=='-1'))throw new WmsError('报表行编码重复或计算口径无效。',400);codes.add(code);return {code,label:requireText(row.label,'报表行名称',120),metric:row.metric as ReportRow['metric'],factor:row.factor as ReportRow['factor'],subjectIds:ids(row.subjectIds)};});
  const rowByCode=new Map(rows.map(row=>[row.code,row]));const visited=new Set<string>(),visiting=new Set<string>();
  function check(code:string,depth=0){if(depth>20||visiting.has(code))throw new WmsError('报表公式循环引用或引用层级过深。',400);if(visited.has(code))return;const row=rowByCode.get(code);if(!row)throw new WmsError('报表公式引用了不存在的行。',400);visiting.add(code);if(row.formula)for(const ref of reportFormulaReferences(row.formula))check(ref,depth+1);visiting.delete(code);visited.add(code);}
  for(const row of rows)check(row.code);
  let closing:ReportDefinition['closing']=null;
  if(input.closing!=null){if(typeof input.closing!=='object'||Array.isArray(input.closing))throw new WmsError('结转映射无效。',400);const row=input.closing as Record<string,unknown>;strictKeys(row,['subjectIds','destinationSubjectId']);const subjectIds=ids(row.subjectIds),destinationSubjectId=requireText(row.destinationSubjectId,'结转目标科目');if(subjectIds.includes(destinationSubjectId))throw new WmsError('结转目标科目不能同时为来源科目。',400);closing={subjectIds,destinationSubjectId};}
  return {rows,closing};
}
function signed(raw:string){return raw.startsWith('-')?-amountUnits(raw.slice(1)):amountUnits(raw);}
export type TrialRow={accountId:string;openingSigned:string;debit:string;credit:string;closingSigned:string};
export function renderFinancialReport(definition:ReportDefinition,trial:readonly TrialRow[],knownSubjectIds:readonly string[]){
  const known=new Set(knownSubjectIds),byId=new Map(trial.map(row=>[row.accountId,row]));
  const byCode=new Map(definition.rows.map(row=>[row.code,row])),values=new Map<string,bigint>(),visiting=new Set<string>();
  function value(code:string):bigint{if(values.has(code))return values.get(code)!;const row=byCode.get(code);if(!row||visiting.has(code))throw new WmsError('公式行缺失或循环引用。',422);visiting.add(code);let total:bigint;
   if(row.formula)total=evaluateReportFormula(row.formula,value);
   else{if(row.subjectIds.some(id=>!known.has(id)))throw new WmsError('报表引用了不存在的科目。',422);const field=({OPENING:'openingSigned',DEBIT:'debit',CREDIT:'credit',CLOSING:'closingSigned'} as const)[row.metric as Exclude<ReportRow['metric'],'CALCULATED'>];if(!field)throw new WmsError('报表行口径无效。',422);total=row.subjectIds.reduce((sum,id)=>sum+signed(byId.get(id)?.[field]??'0'),BigInt(0));if(row.factor==='-1')total=-total;}
   values.set(code,total);visiting.delete(code);return total;
  }
  return definition.rows.map(row=>({code:row.code,label:row.label,amount:unitsAmount(value(row.code)),metric:row.metric,subjectIds:row.subjectIds,...(row.formula?{formula:row.formula}:{})}));
}
export function profitLossClosingLines(definition:ReportDefinition,trial:readonly TrialRow[]){
  if(!definition.closing)throw new WmsError('模板未配置目标端损益结转映射。',422);
  const byId=new Map(trial.map(row=>[row.accountId,row])),lines:{subjectId:string;debit:string;credit:string}[]=[];let net=BigInt(0);
  for(const subjectId of definition.closing.subjectIds){const value=signed(byId.get(subjectId)?.closingSigned??'0');net+=value;if(value!==BigInt(0))lines.push({subjectId,debit:value<BigInt(0)?unitsAmount(-value):'0.000000',credit:value>BigInt(0)?unitsAmount(value):'0.000000'});}
  if(net!==BigInt(0))lines.push({subjectId:definition.closing.destinationSubjectId,debit:net>BigInt(0)?unitsAmount(net):'0.000000',credit:net<BigInt(0)?unitsAmount(-net):'0.000000'});
  return lines;
}
