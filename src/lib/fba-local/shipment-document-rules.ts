import {requireText,strictKeys,WmsInputError} from '@/lib/wms/rules';
import {object} from './rules';
import {shipmentDocumentKinds,type ShipmentDocumentKind} from './shipment-document-contract';
function instant(raw:unknown,label:string){const value=requireText(raw,label);if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))throw new WmsInputError(`${label}须含有效日期和时区。`);return new Date(value).toISOString();}
export function parseShipmentDocument(raw:unknown){
 const input=object(raw);strictKeys(input,['shipmentId','kind','number','evidence','payload','idempotencyKey']);
 if(!shipmentDocumentKinds.includes(input.kind as ShipmentDocumentKind))throw new WmsInputError('货件资料类型无效。');
 const kind=input.kind as ShipmentDocumentKind;
 const header={shipmentId:requireText(input.shipmentId,'货件 ID'),kind,number:requireText(input.number,'资料编号'),evidence:requireText(input.evidence,'来源依据',2000),idempotencyKey:requireText(input.idempotencyKey,'幂等键')};
 const row=object(input.payload);
 if(kind==='DELIVERY_APPOINTMENT'){
  strictKeys(row,['startsAt','endsAt','facilityReference','bookingReference']);
  const startsAt=instant(row.startsAt,'预约开始'),endsAt=instant(row.endsAt,'预约结束');if(endsAt<=startsAt)throw new WmsInputError('预约结束须晚于开始。');
  return {...header,payload:{startsAt,endsAt,facilityReference:requireText(row.facilityReference,'预约地点/仓库依据',500),bookingReference:requireText(row.bookingReference,'预约回执号')}};
 }
 if(kind==='INSURANCE'){
  strictKeys(row,['insurer','currency','insuredAmount','coverFrom','coverTo','premiumFeeId']);
  const currency=requireText(row.currency,'保额币种');if(!/^[A-Z]{3}$/.test(currency))throw new WmsInputError('保额币种无效。');
  if(typeof row.insuredAmount!=='string'||!/^\d{1,18}(?:\.\d{1,6})?$/.test(row.insuredAmount))throw new WmsInputError('保额须为六位小数以内的正十进制字符串。');
  const [whole,fraction='']=row.insuredAmount.split('.');if(BigInt(whole+fraction)===BigInt(0))throw new WmsInputError('保额须大于零。');
  const coverFrom=instant(row.coverFrom,'保障开始'),coverTo=instant(row.coverTo,'保障结束');if(coverTo<=coverFrom)throw new WmsInputError('保障结束须晚于开始。');
  return {...header,payload:{insurer:requireText(row.insurer,'保险公司'),currency,insuredAmount:`${BigInt(whole)}.${fraction.padEnd(6,'0')}`,coverFrom,coverTo,premiumFeeId:row.premiumFeeId===undefined||row.premiumFeeId===null?null:requireText(row.premiumFeeId,'保险费 ID')}};
 }
 strictKeys(row,['containerNumber','sealNumber','billOfLading','boxNumbers']);
 if(!Array.isArray(row.boxNumbers)||!row.boxNumbers.length||row.boxNumbers.length>200)throw new WmsInputError('柜单须关联 1-200 箱。');
 const boxNumbers=row.boxNumbers.map(value=>requireText(value,'箱号',60)).sort();if(new Set(boxNumbers).size!==boxNumbers.length)throw new WmsInputError('柜单箱号重复。');
 return {...header,payload:{containerNumber:requireText(row.containerNumber,'柜号'),sealNumber:requireText(row.sealNumber,'封条号'),billOfLading:requireText(row.billOfLading,'提单号'),boxNumbers}};
}
