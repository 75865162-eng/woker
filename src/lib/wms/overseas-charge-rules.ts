import {allocateLocalCost} from '@/lib/fba-local/cost-allocation';
import {object} from '@/lib/fba-local/rules';
import {WmsError} from './contracts';
import {requireText,strictKeys} from './rules';
import {amountUnits,unitsAmount} from '@/lib/finance/open-item-rules';
export function overseasChargeAllocation(body:Record<string,unknown>,lines:readonly {id:string;quantity:number}[],boxes:readonly {number:string;items:readonly {transferLineId:string;quantity:number}[]}[],estimate:{currency:string|null;estimatedFee:{toFixed:(n:number)=>string}|null}|null){
 const method=requireText(body.allocationMethod,'海外费用分摊方式');if(!['QUANTITY','WEIGHT','VOLUME','VALUE'].includes(method))throw new WmsError('海外费用分摊方式无效。',400);
 const basis=body.basis;if(!Array.isArray(basis))throw new WmsError('须逐明细提供分摊依据。',400);
 const transformed=basis.map(raw=>{const row=object(raw);strictKeys(row,method==='QUANTITY'?['lineId']:method==='WEIGHT'?['lineId','unitWeightKg','unitDimensionalWeightKg']:method==='VOLUME'?['lineId','unitVolumeM3']:['lineId','unitValue']);return row;});
 const allocation=allocateLocalCost({reference:body.reference,stage:'ACTUAL',amount:body.amount,currency:body.currency,method:method==='WEIGHT'?'CHARGEABLE_WEIGHT':method,basis:transformed,hierarchy:{shipments:[{shipmentId:requireText(body.manifestId,'海外装箱资料'),boxes:boxes.map(box=>({number:box.number,items:box.items.map(item=>({lineId:item.transferLineId,quantity:item.quantity}))}))}]}},lines);
 const estimatedAmount=estimate?.currency===allocation.currency&&estimate.estimatedFee?estimate.estimatedFee.toFixed(6):null;
 return {...allocation,allocationMethod:method,estimate:{currency:estimate?.currency??null,amount:estimate?.estimatedFee?.toFixed(6)??null,comparable:estimatedAmount!==null,difference:estimatedAmount===null?null:unitsAmount(amountUnits(allocation.amount)-amountUnits(estimatedAmount))},postingExecuted:false,inventoryCostUpdated:false};
}
