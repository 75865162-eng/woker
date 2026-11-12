import source from './inbound-source-contract.json';
import {readFinanceJson,WireDecimal} from '@/lib/amazon-sync/finance';
import {amazonBusinessData} from '@/lib/amazon-sync/business-data';
import {closeDigest} from '@/lib/finance/close-rules';
import {WmsError} from '@/lib/wms/contracts';
import {object} from './rules';

type Model={fields?:Record<string,{type:string}>;enum?:string[]};
const models=source.models as Record<string,Model>;
const operations=source.operations as Record<string,{method:string;pathParameters:string[];responseType:string}>;
function invalid():never{throw new WmsError('Amazon 读取回包与来源 DTO 或请求范围不符。',422);}
/** Separate external evidence: never updates local packing, physical stock or received quantity. */
export function normalizeRemoteReadSnapshot(operation:string,request:Record<string,unknown>,rawBody:string){
 const definition=operations[operation];if(!definition||definition.method!=='GET'||!definition.pathParameters.includes('inboundPlanId'))return null;
 if(Buffer.byteLength(rawBody)>32000)invalid();
 const root=object(readFinanceJson(rawBody)),path=object(request.pathParameters),externalPlanId=path.inboundPlanId;
 if(typeof externalPlanId!=='string')invalid();
 for(const key of ['inboundPlanId','shipmentId'])if(root[key]!==undefined&&root[key]!==path[key])invalid();
 if(operation==='getInboundPlan'&&root.inboundPlanId!==externalPlanId)invalid();
 if(operation==='getShipment'&&root.shipmentId!==path.shipmentId)invalid();
 const pagination=root.pagination===undefined?null:object(root.pagination);
 const continuationTokenPresent=Boolean(pagination&&typeof pagination.nextToken==='string'&&pagination.nextToken.length);
 if(pagination?.nextToken!==undefined&&typeof pagination.nextToken!=='string')invalid();
 function project(value:unknown,type:string,depth=0):unknown{
  if(depth>25)invalid();if(value===null)return null;
  const list=/^List<(.+)>$/.exec(type);if(list){if(!Array.isArray(value)||value.length>2000)invalid();return value.map(row=>project(row,list[1],depth+1));}
  if(type==='Integer'||type==='BigDecimal'){if(!(value instanceof WireDecimal))invalid();if(type==='Integer'&&!/^\d+$/.test(value.source))invalid();return value.source;}
  if(type==='String'||type==='OffsetDateTime'){if(typeof value!=='string'||value.length>8000)invalid();return value;}
  if(type==='Boolean'){if(typeof value!=='boolean')invalid();return value;}
  const model=models[type];if(!model)invalid();if(model.enum){if(typeof value!=='string')invalid();return value;}
  const input=object(value),result:Record<string,unknown>={};
  for(const [key,field]of Object.entries(model.fields??{}))if(input[key]!==undefined&&!['nextToken','paginationToken'].includes(key))result[key]=project(input[key],field.type,depth+1);
  return result;
 }
 // A successful list must contain its declared collection, including an explicit empty list.
 const responseModel=models[definition.responseType];
 if(operation.startsWith('list'))for(const [key,field]of Object.entries(responseModel?.fields??{}))if(field.type.startsWith('List<')&&!Array.isArray(root[key]))invalid();
 const facts=amazonBusinessData(project(root,definition.responseType) as Parameters<typeof amazonBusinessData>[0]);
 const normalized={apiVersion:source.provenance.apiVersion,source:'REMOTE_ACTION_RESPONSE',operation,responseType:definition.responseType,requestScope:{inboundPlanId:externalPlanId,...(typeof path.shipmentId==='string'?{shipmentId:path.shipmentId}:{}),...(typeof path.packingGroupId==='string'?{packingGroupId:path.packingGroupId}:{})},facts,quantitySemantics:'AMAZON_DECLARED_NOT_PHYSICAL_RECEIPT',coverage:'ONE_RESPONSE_PAGE',planReceiptCompletenessVerified:false};
 return {externalPlanId,shipmentId:typeof path.shipmentId==='string'?path.shipmentId:null,sourceHash:closeDigest({rawBody,operation,path}),pageComplete:true,continuationTokenPresent,normalized};
}
