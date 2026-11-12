import {WmsError} from './contracts';
export const agingWindows=[30,60,90,180,365] as const;
export type AgingEvidence={quantity:string;windows:{days:number;snapshotQty:string|null;outboundQty:string|null}[]};
/** Snapshot-minus-outbound estimator from Wimoor WhseUnsalableReportMapper.findByCondition.
 * This is a warehouse turnover estimate, not FIFO lot dating or Amazon retail sales. */
export function stockAgeEstimate(evidence:AgingEvidence){
 const parse=(value:string)=>{if(!/^\d+$/.test(value))throw new WmsError('周转数量须为非负整数字符串。',400);return BigInt(value);};
 const quantity=parse(evidence.quantity),survivors:bigint[]=[];
 for(const days of agingWindows){const row=evidence.windows.find(row=>row.days===days);if(!row||row.snapshotQty===null||row.outboundQty===null)return null;const difference=parse(row.snapshotQty)-parse(row.outboundQty);survivors.push(difference>BigInt(0)?difference:BigInt(0));}
 const bands=[quantity-survivors[0],...survivors.slice(0,-1).map((value,index)=>value>=survivors[index+1]?value-survivors[index+1]:value),survivors[4]];
 if(bands.some(value=>value<BigInt(0))||bands.reduce((sum,value)=>sum+value,BigInt(0))!==quantity)return null;
 return {days0To30:bands[0].toString(),days30To60:bands[1].toString(),days60To90:bands[2].toString(),days90To180:bands[3].toString(),days180To365:bands[4].toString(),days365Plus:bands[5].toString(),excessOver90DayOutbound:(quantity>parse(evidence.windows[2].outboundQty!)?quantity-parse(evidence.windows[2].outboundQty!):BigInt(0)).toString()};
}
