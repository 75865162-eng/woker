import source from './inbound-source-contract.json';
import {WmsError} from '@/lib/wms/contracts';

type Field={type:string;required:boolean;collection?:string};
type Model={fields?:Record<string,Field>;enum?:string[];sourceSha256:string};
export type InboundOperationName=keyof typeof source.operations;
export type InboundOperationInput={operation:InboundOperationName;pathParameters?:Record<string,string>;query?:Record<string,string|number|string[]>;body?:unknown};
export const inboundOperationNames:readonly string[]=Object.keys(source.operations);
export const inboundOperationCatalog=source.operations;
export const inboundAsyncOperations:readonly string[]=Object.entries(source.operations).filter(([,definition])=>definition.asynchronous).map(([name])=>name);
export const inboundVoidOperations:readonly string[]=Object.entries(source.operations).filter(([,definition])=>definition.responseType==='Void').map(([name])=>name);
export const inboundContractProvenance=source.provenance;
/** Only source-proven GET identity can rule out an external mutation. Unknown operations stay conservative. */
export function inboundOperationIsReadOnly(operation:string){return Object.prototype.hasOwnProperty.call(source.operations,operation)&&(source.operations as Record<string,{method:string}>)[operation].method==='GET';}
const models=source.models as unknown as Record<string,Model>;
type Operation={method:string;path:string;pathParameters:string[];query:Record<string,Field>;bodyType:string|null;bodyRequired:boolean};
const operations=source.operations as Record<string,Operation>;
function invalid(path:string,reason:string):never{throw new WmsError(`Inbound 请求 ${path} ${reason}。`,400);}
function object(raw:unknown,path:string):Record<string,unknown>{if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype)invalid(path,'须为 JSON 对象');return raw as Record<string,unknown>;}
function keys(raw:Record<string,unknown>,allowed:string[],path:string){if(Object.keys(raw).some(key=>!allowed.includes(key)))invalid(path,'包含未定义字段');}
function text(raw:unknown,path:string,max=4096):string{if(typeof raw!=='string'||!raw.length||raw.length>max||/[\u0000-\u001f\u007f]/.test(raw))invalid(path,'文本无效');return raw;}
function decimal(raw:unknown,path:string){
 // Internal decimal strings become wire JSON numbers only if a serialize/parse roundtrip retains every digit.
 if(typeof raw!=='string'||!/^\d{1,18}(?:\.\d{1,12})?$/.test(raw))invalid(path,'十进制值须为非负精确字符串');
 const value=Number(raw),normalize=(input:string)=>input.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
 if(!Number.isFinite(value)||normalize(String(value))!==normalize(raw))invalid(path,'数值不能无损表示为外部 JSON 数字');return value;
}
function validate(raw:unknown,type:string,path:string,depth=0):unknown{
 if(depth>20)invalid(path,'嵌套过深');
 const list=/^List<(.+)>$/.exec(type);if(list){if(!Array.isArray(raw)||raw.length>2000)invalid(path,'清单无效或超过 2000 项');return raw.map((value,index)=>validate(value,list[1],`${path}[${index}]`,depth+1));}
 if(type==='String')return text(raw,path);
 if(type==='OffsetDateTime'){const value=text(raw,path,80);if(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))invalid(path,'时间须带明确时区');return value;}
 if(type==='Integer'){if(typeof raw!=='number'||!Number.isSafeInteger(raw)||raw<0||raw>2147483647)invalid(path,'整数无效');return raw;}
 if(type==='BigDecimal')return decimal(raw,path);
 if(type==='Boolean'){if(typeof raw!=='boolean')invalid(path,'须为布尔值');return raw;}
 const model=models[type];if(!model)invalid(path,'来源类型未支持');if(model.enum){if(typeof raw!=='string'||!model.enum.includes(raw))invalid(path,'枚举值无效');return raw;}
 const value=object(raw,path),fields=model.fields!;keys(value,Object.keys(fields),path);const result:Record<string,unknown>={};
 for(const [name,field]of Object.entries(fields)){
  if(value[name]==null){if(field.required)invalid(`${path}.${name}`,'为必填');if(value[name]===null)invalid(`${path}.${name}`,'可选字段请省略，不能为 null');continue;}
  result[name]=validate(value[name],field.type,`${path}.${name}`,depth+1);
  if(field.required&&Array.isArray(result[name])&&!(result[name] as unknown[]).length)invalid(`${path}.${name}`,'必填清单不能为空');
 }
 if((type==='ItemInput'||type==='MskuQuantity'||type==='BoxInput')&&Number(result.quantity)<1)invalid(`${path}.quantity`,'数量须为正整数');
 if(type==='Dimensions'&&['height','length','width'].some(field=>Number(result[field])<=0))invalid(path,'长宽高须为正数');
 if(type==='Weight'&&Number(result.value)<=0)invalid(path,'重量须为正数');
 if(type==='PackageGroupingInput'&&Boolean(result.packingGroupId)===Boolean(result.shipmentId))invalid(path,'须仅提供 packingGroupId 或 shipmentId 之一');
 return result;
}
/** Strict source SDK shape adapter. This never proves latest official parity, authorization or business readiness. */
export function parseInboundOperation(raw:unknown){
 let serialized:string|undefined;try{serialized=JSON.stringify(raw);}catch{invalid('root','须为可序列化 JSON');}if(typeof serialized!=='string')invalid('root','须为 JSON 对象');if(Buffer.byteLength(serialized)>1024*1024)invalid('root','超过 1MB');
 const input=object(raw,'root');keys(input,['operation','pathParameters','query','body'],'root');const operation=text(input.operation,'operation',100) as InboundOperationName,definition=Object.prototype.hasOwnProperty.call(operations,operation)?operations[operation]:undefined;if(!definition)invalid('operation','不在源协议白名单');
 const parameters=input.pathParameters===undefined?{}:object(input.pathParameters,'pathParameters');keys(parameters,definition.pathParameters,'pathParameters');let path=definition.path;
 for(const key of definition.pathParameters){const value=text(parameters[key],`pathParameters.${key}`,200);if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value))invalid(`pathParameters.${key}`,'标识不合法');path=path.replace(`{${key}}`,encodeURIComponent(value));}
 const query=input.query===undefined?{}:object(input.query,'query');keys(query,Object.keys(definition.query),'query');const search=new URLSearchParams();
 for(const [key,field]of Object.entries(definition.query)){
  const value=query[key];if(value===undefined){if(field.required)invalid(`query.${key}`,'为必填');continue;}
  const parsed=validate(value,field.type,`query.${key}`);if(key==='pageSize'&&(Number(parsed)<1||Number(parsed)>100))invalid('query.pageSize','须为 1–100');
  if(Array.isArray(parsed))for(const entry of parsed)search.append(key,String(entry));else search.set(key,String(parsed));
 }
 let body:unknown;
 if(definition.bodyType){if(input.body===undefined){if(definition.bodyRequired)invalid('body','为必填');}else body=validate(input.body,definition.bodyType,'body');}
 else if(input.body!==undefined)invalid('body','此操作不接受请求体');
 if(body!==undefined&&Buffer.byteLength(JSON.stringify(body))>1024*1024)invalid('body','超过 1MB');
 // Required lists in create/packing cannot become an empty purported action.
 if(operation==='createInboundPlan'){
  const value=body as {destinationMarketplaces:string[];items:{quantity:number}[]};if(value.destinationMarketplaces.length!==1||!value.items.length||value.items.some(row=>row.quantity<1))invalid('body','须有一个站点及正数量明细');
 }
 return {operation,method:definition.method as 'GET'|'POST'|'PUT',path:path+(search.size?`?${search}`:''),...(body===undefined?{}:{body}),mutating:definition.method!=='GET'};
}
/** Method is part of operation identity: GET list and POST generation share paths. */
export function inboundOperationForRequest(url:string,method:string){
 const path=new URL(url).pathname;
 for(const [operation,definition]of Object.entries(operations)){
  if(definition.method!==method)continue;
  const pattern='^'+definition.path.replace(/[.*+?^$()|[\]\\]/g,'\\$&').replace(/\{\w+\}/g,'[A-Za-z0-9_-]+')+'$';
  if(new RegExp(pattern).test(path))return operation;
 }return undefined;
}
