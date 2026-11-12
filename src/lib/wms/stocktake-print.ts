import {WmsError} from './contracts';
type PrintLine={lotCode:string;barcode:string|null;countedQty:number|null;baselineOnHand?:number};
type PrintLocation={code:string;lines:PrintLine[]};
export type StocktakePrint={number:string;status:string;mode:string;blind:boolean;revision:number;locations:PrintLocation[]};
const text=(value:unknown)=>typeof value==='string'?value:'';
function escape(value:unknown){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));}
/** Allow-list presentation: blind exports never contain baselines, IDs, or hidden raw fields. */
export function stocktakePrintDocument(raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsError('盘点打印资料无效。',400);
 const row=raw as Record<string,unknown>;if(!Array.isArray(row.locations))throw new WmsError('盘点打印须读取单据详情。',422);
 const blind=row.blind===true,locations:PrintLocation[]=row.locations.map(raw=>{const location=raw as Record<string,unknown>,label=location.location as Record<string,unknown>;if(!Array.isArray(location.lines))throw new WmsError('盘点库位资料无效。',422);return {code:text(label?.code),lines:location.lines.map(raw=>{const line=raw as Record<string,unknown>,lot=line.lot as Record<string,unknown>;return {lotCode:text(lot?.lotCode),barcode:typeof lot?.barcode==='string'?lot.barcode:null,countedQty:typeof line.countedQty==='number'?line.countedQty:null,...(!blind&&typeof line.baselineOnHand==='number'?{baselineOnHand:line.baselineOnHand}:{})};})};});
 return {number:text(row.number),status:text(row.status),mode:text(row.mode),blind,revision:typeof row.revision==='number'?row.revision:0,locations};
}
export function renderStocktakePrint(raw:unknown){
 const document=stocktakePrintDocument(raw),review=['REVIEW','POSTED'].includes(document.status);
 const headers=['库位','批次','条码',...(!document.blind?['账面']:[]),'实盘',...(!document.blind&&review?['差异']:[])];
 const rows=document.locations.flatMap(location=>location.lines.length?location.lines.map(line=>[location.code,line.lotCode,line.barcode??'',...(!document.blind?[line.baselineOnHand??'']:[]),review?(line.countedQty??''):'',...(!document.blind&&review?[line.countedQty==null||line.baselineOnHand==null?'':line.countedQty-line.baselineOnHand]:[])]):[[location.code,'','',...(!document.blind?['']:[]),'',...(!document.blind&&review?['']:[])]]);
 const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>盘点单 '+escape(document.number)+'</title><style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:10px;text-align:left}td{height:26px}@media print{body{margin:8mm}thead{display:table-header-group}tr{break-inside:avoid}}</style><body><h1>盘点单 '+escape(document.number)+'</h1><p>状态 '+escape(document.status)+' · 模式 '+escape(document.mode)+' · 版本 '+document.revision+(document.blind?' · 盲盘：不输出账面及差异':'')+'</p><p>打印内容仅为此版本作业凭据，实盘结果仍须回系统保存。盘点人：________ 复核人：________ 日期：________</p><table><thead><tr>'+headers.map(value=>'<th>'+escape(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+escape(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></body></html>';
 return {html,document};
}
