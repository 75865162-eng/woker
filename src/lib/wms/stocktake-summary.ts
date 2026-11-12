type CountLine={lotId:string;baselineOnHand:number;countedQty:number|null};
type Location={locationId:string;lines:CountLine[]};
/** Gross gains/losses stay separate even when the document net is zero. Blind drafts expose only progress. */
export function stocktakeSummary(row:{blind:boolean;status:string;locations?:Location[]}){
 const locations=row.locations??[],lines=locations.flatMap(location=>location.lines),hidden=row.blind&&['DRAFT','COUNTING'].includes(row.status),allCounted=lines.length>0&&lines.every(line=>line.countedQty!==null);
 const totals=(items:readonly CountLine[])=>{const complete=items.length>0&&items.every(item=>item.countedQty!==null);return {lineCount:items.length,countedLines:items.filter(item=>item.countedQty!==null).length,baselineQty:hidden?null:items.reduce((n,item)=>n+BigInt(item.baselineOnHand),BigInt(0)).toString(),countedQty:complete?items.reduce((n,item)=>n+BigInt(item.countedQty!),BigInt(0)).toString():null,gainQty:hidden||!complete?null:items.reduce((n,item)=>n+BigInt(Math.max(0,item.countedQty!-item.baselineOnHand)),BigInt(0)).toString(),lossQty:hidden||!complete?null:items.reduce((n,item)=>n+BigInt(Math.max(0,item.baselineOnHand-item.countedQty!)),BigInt(0)).toString()};};
 return {dataStatus:allCounted?'COMPLETE':'NEEDS_DATA',baselineVisible:!hidden,...totals(lines),locations:locations.map(location=>({locationId:location.locationId,...totals(location.lines)})),lots:[...new Set(lines.map(line=>line.lotId))].sort().map(lotId=>({lotId,...totals(lines.filter(line=>line.lotId===lotId))}))};
}
