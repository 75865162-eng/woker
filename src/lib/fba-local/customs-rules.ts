import {requirePositiveQuantity,requireText,strictKeys,WmsInputError} from '@/lib/wms/rules';
import {object} from './rules';
const scale=BigInt(1000000);
const format=(value:bigint)=>`${value/scale}.${String(value%scale).padStart(6,'0')}`;
function country(value:unknown){const result=requireText(value,'国家代码');if(!/^[A-Z]{2}$/.test(result))throw new WmsInputError('国家代码须为两位大写字母。');return result;}
export function parseCustomsDraft(raw:unknown,shipmentItems:readonly{planLineId:string;quantity:number}[]){
 const input=object(raw);strictKeys(input,['shipmentId','number','destinationCountry','currency','exporter','importer','templateReference','evidence','idempotencyKey','items']);
 const shipmentId=requireText(input.shipmentId,'货件 ID'),number=requireText(input.number,'报关资料编号'),currency=requireText(input.currency,'申报币种');
 if(!/^[A-Z]{3}$/.test(currency))throw new WmsInputError('申报币种须为三个大写字母。');
 const expected=new Map<string,number>();for(const item of shipmentItems)expected.set(item.planLineId,(expected.get(item.planLineId)??0)+item.quantity);
 if(!expected.size||!Array.isArray(input.items)||input.items.length!==expected.size)throw new WmsInputError('报关明细须覆盖关联货件的全部计划明细。');
 const seen=new Set<string>();
 const items=input.items.map(value=>{
  const row=object(value);strictKeys(row,['planLineId','description','hsCode','originCountry','quantity','unit','unitPrice']);
  const planLineId=requireText(row.planLineId,'计划明细'),quantity=requirePositiveQuantity(row.quantity),hsCode=requireText(row.hsCode,'HS 编码');
  if(seen.has(planLineId)||expected.get(planLineId)!==quantity)throw new WmsInputError('报关明细重复、越界或数量与货件不一致。');seen.add(planLineId);
  if(!/^\d{6,12}$/.test(hsCode))throw new WmsInputError('HS 编码须为 6-12 位数字，适用性由申报方核实。');
  if(typeof row.unitPrice!=='string'||!/^\d{1,12}(?:\.\d{1,6})?$/.test(row.unitPrice))throw new WmsInputError('申报单价须为最多六位小数的十进制字符串。');
  const [whole,fraction='']=row.unitPrice.split('.'),price=BigInt(whole)*scale+BigInt(fraction.padEnd(6,'0'));
  if(price<=BigInt(0))throw new WmsInputError('申报单价须大于零。');
  return {planLineId,quantity,description:requireText(row.description,'申报品名',500),hsCode,originCountry:country(row.originCountry),unit:requireText(row.unit,'申报单位',30),unitPrice:format(price),declaredValue:format(price*BigInt(quantity))};
 }).sort((a,b)=>a.planLineId.localeCompare(b.planLineId));
 return {shipmentId,number,currency,destinationCountry:country(input.destinationCountry),exporter:requireText(input.exporter,'出口方',500),importer:requireText(input.importer,'进口方',500),templateReference:requireText(input.templateReference,'申报模板来源',500),evidence:requireText(input.evidence,'申报资料依据',2000),idempotencyKey:requireText(input.idempotencyKey,'幂等键'),items};
}
function escapeXml(value:string){if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value))throw new WmsInputError('资料包含 XML 不允许的字符。');return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));}
/** Internal data interchange only. No claim of CBP/Amazon/customs schema conformance. */
export function customsDraftXml(draft:Omit<ReturnType<typeof parseCustomsDraft>,'idempotencyKey'>){
 const tag=(key:string,value:string|number)=>`<${key}>${escapeXml(String(value))}</${key}>`;
 return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomsDraft xmlns="urn:erp:customs-draft:1">${tag('Number',draft.number)}${tag('LocalShipmentId',draft.shipmentId)}${tag('DestinationCountry',draft.destinationCountry)}${tag('Currency',draft.currency)}${tag('Exporter',draft.exporter)}${tag('Importer',draft.importer)}${tag('TemplateReference',draft.templateReference)}${tag('Evidence',draft.evidence)}<Items>${draft.items.map(item=>`<Item>${tag('PlanLineId',item.planLineId)}${tag('Description',item.description)}${tag('HsCode',item.hsCode)}${tag('OriginCountry',item.originCountry)}${tag('Quantity',item.quantity)}${tag('Unit',item.unit)}${tag('UnitPrice',item.unitPrice)}${tag('DeclaredValue',item.declaredValue)}</Item>`).join('')}</Items></CustomsDraft>`;
}
export const clearanceTypes=['FILED','HELD','RELEASED','REJECTED'] as const;
export function parseClearanceEvent(raw:unknown,prior:{eventType:string;occurredAt:Date}|null,now:Date){
 const row=object(raw);strictKeys(row,['declarationId','eventType','occurredAt','reference','evidence','idempotencyKey']);
 if(!clearanceTypes.includes(row.eventType as typeof clearanceTypes[number]))throw new WmsInputError('清关事件无效。');
 const eventType=row.eventType as typeof clearanceTypes[number];
 if(prior&&['RELEASED','REJECTED'].includes(prior.eventType))throw new WmsInputError('清关已结束，不能追加节点。',409);
 if(!prior&&eventType!=='FILED'||prior&&eventType==='FILED')throw new WmsInputError('清关首节点须为申报登记，不能重复登记。',409);
 const text=requireText(row.occurredAt,'发生时间');if(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text))throw new WmsInputError('清关时间须有时区。');
 const occurredAt=new Date(text);if(!Number.isFinite(occurredAt.getTime())||occurredAt>now||prior&&occurredAt<prior.occurredAt)throw new WmsInputError('清关时间无效、晚于当前或早于上一节点。');
 return {declarationId:requireText(row.declarationId,'报关资料 ID'),eventType,occurredAt,reference:requireText(row.reference,'申报/清关回执号'),evidence:requireText(row.evidence,'清关依据',2000),idempotencyKey:requireText(row.idempotencyKey,'幂等键')};
}
