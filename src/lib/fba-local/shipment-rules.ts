import { requirePositiveQuantity,requireText,strictKeys,WmsInputError } from '@/lib/wms/rules';
import { object } from './rules';
export type ShipmentSourceItem={id:string;sellerSku:string;fnsku:string|null;declaredQuantity:number};
export function parseShipmentMapping(raw:unknown,lines:readonly{id:string;quantity:number}[],items:readonly ShipmentSourceItem[],prior:readonly{planLineId:string;quantity:number}[]) {
  if(!Array.isArray(raw)||!raw.length||raw.length>500)throw new WmsInputError('货件映射须为 1-500 行。');
  const local=new Map(lines.map(row=>[row.id,row.quantity]));
  const external=new Map(items.map(row=>[row.id,row]));
  if(external.size!==items.length||!items.length)throw new WmsInputError('来源货件明细缺失或重复。',409);
  const localTotals=new Map<string,number>(),sourceTotals=new Map<string,number>(),seen=new Set<string>();
  for(const row of prior)localTotals.set(row.planLineId,(localTotals.get(row.planLineId)??0)+row.quantity);
  const result=raw.map(value=>{
    const row=object(value);strictKeys(row,['planLineId','observationId','quantity']);
    const planLineId=requireText(row.planLineId,'本地计划明细'),observationId=requireText(row.observationId,'来源明细'),quantity=requirePositiveQuantity(row.quantity);
    const source=external.get(observationId),key=JSON.stringify([planLineId,observationId]);
    if(!local.has(planLineId)||!source||seen.has(key))throw new WmsInputError('映射包含外部计划行、未知来源行或重复项。');
    seen.add(key);localTotals.set(planLineId,(localTotals.get(planLineId)??0)+quantity);sourceTotals.set(observationId,(sourceTotals.get(observationId)??0)+quantity);
    return{planLineId,observationId,quantity,sellerSku:source.sellerSku,fnsku:source.fnsku};
  }).sort((a,b)=>a.observationId.localeCompare(b.observationId)||a.planLineId.localeCompare(b.planLineId));
  if([...localTotals].some(([id,qty])=>!Number.isSafeInteger(qty)||!local.has(id)||qty>local.get(id)!))throw new WmsInputError('累计货件数量超过本地计划数量。',409);
  if(items.some(item=>sourceTotals.get(item.id)!==item.declaredQuantity))throw new WmsInputError('须准确覆盖货件全部来源明细数量；不能按相同 SKU 合并来源行。',409);
  return result;
}
