const cell=(value:unknown)=>{const text=value==null?'':String(value),safe=/^[=+\-@\t\r]/.test(text)?"'"+text:text;return '"'+safe.replace(/"/g,'""')+'"';};
export function inventoryRiskCsv(raw:unknown){
 const report=raw as {id:string;snapshotId:string;status:string;requestHash:string;result:{snapshotDate:string;currency:string;status:string;items:{productRecordId:string;sku:string;quantity:string;stagnant:boolean|null;proposedProvision:string|null;provisionDelta:string|null;status:string}[]}};
 const headers=['assessmentId','snapshotId','assessmentStatus','requestHash','snapshotDate','currency','productRecordId','sku','quantity','stagnant','proposedProvision','provisionDelta','dataStatus','postingExecuted'];
 return '\uFEFF'+[headers,...report.result.items.map(row=>[report.id,report.snapshotId,report.status,report.requestHash,report.result.snapshotDate,report.result.currency,row.productRecordId,row.sku,row.quantity,row.stagnant,row.proposedProvision,row.provisionDelta,row.status,false])].map(row=>row.map(cell).join(',')).join('\r\n');
}
