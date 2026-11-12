import {object} from './rules';
import {requireText,requireRevision,strictKeys} from '@/lib/wms/rules';
import {WmsError} from '@/lib/wms/contracts';
import {amountUnits,unitsAmount} from '@/lib/finance/open-item-rules';
export function customsTarget(raw:Record<string,unknown>){const destinationCountry=requireText(raw.destinationCountry,'目的国家'),forwarder=requireText(raw.forwarder,'目标货代/申报渠道',120);if(!/^[A-Z]{2}$/.test(destinationCountry))throw new WmsError('目的国家须为两位大写字母。',400);return {destinationCountry,forwarder};}
export function parseCustomsProfile(raw:unknown){
 const body=object(raw);strictKeys(body,['productRecordId','destinationCountry','forwarder','version','sourceReference','values']);const values=object(body.values);strictKeys(values,['description','hsCode','originCountry','unit','unitPrice','currency','priceBasis','priceRate']);
 const hsCode=requireText(values.hsCode,'HS 编码'),originCountry=requireText(values.originCountry,'原产国'),currency=requireText(values.currency,'币种');if(!/^\d{6,12}$/.test(hsCode)||!/^[A-Z]{2}$/.test(originCountry)||!/^[A-Z]{3}$/.test(currency))throw new WmsError('商品申报 HS/国家/币种格式无效。',400);
 const unitPrice=unitsAmount(amountUnits(requireText(values.unitPrice,'申报单价'))),priceRate=unitsAmount(amountUnits(requireText(values.priceRate,'目标申报比例')));if(amountUnits(unitPrice)<=BigInt(0)||amountUnits(priceRate)<=BigInt(0))throw new WmsError('申报单价与目标比例须大于零。',400);
 return {productRecordId:requireText(body.productRecordId,'商品主档 ID'),...customsTarget(body),version:requireRevision(body.version),sourceReference:requireText(body.sourceReference,'商品申报设置依据',2000),values:{description:requireText(values.description,'申报品名',500),hsCode,originCountry,unit:requireText(values.unit,'申报单位',30),currency,unitPrice,priceBasis:requireText(values.priceBasis,'目标定价依据',500),priceRate}};
}
