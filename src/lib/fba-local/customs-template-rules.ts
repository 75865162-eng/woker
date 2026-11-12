import {WmsError} from '@/lib/wms/contracts';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {amountUnits,unitsAmount} from '@/lib/finance/open-item-rules';
import {object} from './rules';
const headerFields=['number','shipmentId','destinationCountry','currency','exporter','importer','templateReference','evidence'] as const;
const itemFields=['planLineId','description','hsCode','originCountry','quantity','unit','unitPrice','declaredValue'] as const;
type Mapping={field:string;element:string;type:'TEXT'|'DECIMAL'|'INTEGER'|'COUNTRY'|'CURRENCY'|'HS_CODE';required:boolean;maxLength:number};
export type CustomsTemplateDefinition={root:string;namespace:string;itemsElement:string;itemElement:string;header:Mapping[];items:Mapping[]};
const element=(value:unknown)=>{const name=requireText(value,'XML 元素名称',80);if(!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)||/^xml/i.test(name))throw new WmsError('XML 名称须为无前缀的合法元素名，不允许 XML 保留名。',400);return name;};
export function parseCustomsTemplateDefinition(raw:unknown):CustomsTemplateDefinition{
 const body=object(raw);strictKeys(body,['root','namespace','itemsElement','itemElement','header','items']);
 const namespace=requireText(body.namespace,'目标 XML namespace',200);if(!/^(?:urn:|https?:\/\/)[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/.test(namespace))throw new WmsError('namespace 须为明确 URI。',400);
 const mapping=(raw:unknown,allowed:readonly string[])=>{if(!Array.isArray(raw)||!raw.length||raw.length>30)throw new WmsError('模板映射须有 1–30 项。',400);const fields=new Set<string>(),elements=new Set<string>();return raw.map(value=>{const row=object(value);strictKeys(row,['field','element','type','required','maxLength']);const field=requireText(row.field,'来源字段'),name=element(row.element);if(!allowed.includes(field)||fields.has(field)||elements.has(name))throw new WmsError('模板字段须来自正式字段白名单且字段/元素无重复。',400);fields.add(field);elements.add(name);if(!['TEXT','DECIMAL','INTEGER','COUNTRY','CURRENCY','HS_CODE'].includes(String(row.type))||typeof row.required!=='boolean'||typeof row.maxLength!=='number'||!Number.isSafeInteger(row.maxLength)||row.maxLength<1||row.maxLength>2000)throw new WmsError('模板字段约束无效。',400);return {field,element:name,type:row.type as Mapping['type'],required:row.required,maxLength:row.maxLength};});};
 const definition={root:element(body.root),namespace,itemsElement:element(body.itemsElement),itemElement:element(body.itemElement),header:mapping(body.header,headerFields),items:mapping(body.items,itemFields)};
 if(definition.header.some(row=>row.element===definition.itemsElement))throw new WmsError('头字段不能与明细容器同名。',400);
 for(const field of ['number','destinationCountry','currency'])if(!definition.header.some(row=>row.field===field&&row.required))throw new WmsError('模板须包含必填编号、目的国及币种映射。',400);
 for(const field of ['description','hsCode','originCountry','quantity','unit','unitPrice','declaredValue'])if(!definition.items.some(row=>row.field===field&&row.required))throw new WmsError('模板须完整映射必填申报明细。',400);
 return definition;
}
function xmlText(value:string){if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value))throw new WmsError('资料含 XML 禁用字符。',422);return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));}
function fieldText(mapping:Mapping,value:unknown){
 if(value==null||value===''){if(mapping.required)throw new WmsError('目标模板必填字段缺失：'+mapping.field,422);return '';}
 if(typeof value!=='string'&&typeof value!=='number')throw new WmsError('模板字段须为标量。',422);const text=String(value);if(text.length>mapping.maxLength)throw new WmsError('字段超过目标模板长度：'+mapping.field,422);
 if(mapping.type==='DECIMAL')amountUnits(text);if(mapping.type==='INTEGER'&&!/^(?:0|[1-9]\d{0,23})$/.test(text))throw new WmsError('目标模板整数字段无效。',422);if(mapping.type==='COUNTRY'&&!/^[A-Z]{2}$/.test(text)||mapping.type==='CURRENCY'&&!/^[A-Z]{3}$/.test(text)||mapping.type==='HS_CODE'&&!/^\d{6,12}$/.test(text))throw new WmsError('目标模板国家/币种/HS 字段无效。',422);return '<'+mapping.element+'>'+xmlText(text)+'</'+mapping.element+'>';
}
export function renderTargetCustomsXml(definition:CustomsTemplateDefinition,header:Record<string,unknown>,items:Record<string,unknown>[]){
 if(!items.length||items.length>100)throw new WmsError('目标模板须有 1–100 条申报明细。',422);
 for(const item of items){if(typeof item.quantity!=='number'||!Number.isSafeInteger(item.quantity)||item.quantity<=0||typeof item.unitPrice!=='string'||typeof item.declaredValue!=='string'||unitsAmount(amountUnits(item.unitPrice)*BigInt(item.quantity))!==unitsAmount(amountUnits(item.declaredValue)))throw new WmsError('申报数量、单价和申报价值不守恒。',422);}
 const xml='<?xml version="1.0" encoding="UTF-8"?>\n<'+definition.root+' xmlns="'+xmlText(definition.namespace)+'">'+definition.header.map(mapping=>fieldText(mapping,header[mapping.field])).join('')+'<'+definition.itemsElement+'>'+items.map(item=>'<'+definition.itemElement+'>'+definition.items.map(mapping=>fieldText(mapping,item[mapping.field])).join('')+'</'+definition.itemElement+'>').join('')+'</'+definition.itemsElement+'></'+definition.root+'>';
 if(Buffer.byteLength(xml)>512000)throw new WmsError('目标 XML 超过 500KB。',413);
 return {xml,validation:{basis:'TARGET_MAPPING_CONTRACT',requiredFields:true,fieldTypes:true,lengths:true,valueConservation:true,officialSchemaValidated:false,remoteSubmitted:false}};
}
