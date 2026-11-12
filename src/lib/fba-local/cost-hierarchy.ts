import { requirePositiveQuantity, requireText, strictKeys, WmsInputError } from '@/lib/wms/rules';
import { object } from './rules';

type Line = { lineId: string; quantity: number; basis: string };
const micros = (value: string) => BigInt(value.replace('.', ''));
const amount = (value: bigint) => `${value / BigInt(1000000)}.${String(value % BigInt(1000000)).padStart(6, '0')}`;

/** Largest remainder at each boundary, with deterministic identity based ties. */
function split(total: bigint, rows: readonly { id: string; weight: bigint }[]) {
  const sum = rows.reduce((n, row) => n + row.weight, BigInt(0));
  if (!sum || rows.some(row => row.weight <= BigInt(0))) throw new WmsInputError('层级分摊依据须大于零。');
  const shares = rows.map(row => ({ ...row, value: total * row.weight / sum, remainder: total * row.weight % sum }));
  const remaining = total - shares.reduce((n, row) => n + row.value, BigInt(0));
  const ranked = [...shares].sort((a,b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (let i=0; i<Number(remaining); i++) ranked[i].value++;
  return new Map(shares.map(row => [row.id, row.value]));
}

export function allocateCostHierarchy(raw: unknown, total: string, lines: readonly Line[]) {
  const input = object(raw); strictKeys(input, ['shipments']);
  if (!Array.isArray(input.shipments) || !input.shipments.length || input.shipments.length > 20) throw new WmsInputError('层级分摊须包含 1-20 个货件。');
  const byLine = new Map(lines.map(line => [line.lineId,line]));
  const totals = new Map<string,number>(), shipmentIds = new Set<string>(), boxNumbers = new Set<string>();
  let itemCount=0;
  const shipments=input.shipments.map(value=>{
    const row=object(value);strictKeys(row,['shipmentId','boxes']);
    const shipmentId=requireText(row.shipmentId,'关联货件 ID');
    if(shipmentIds.has(shipmentId))throw new WmsInputError('层级分摊货件重复。');shipmentIds.add(shipmentId);
    if(!Array.isArray(row.boxes)||!row.boxes.length)throw new WmsInputError('每个货件须有装箱明细。');
    const boxes=row.boxes.map(value=>{
      const box=object(value);strictKeys(box,['number','items']);const number=requireText(box.number,'箱号',60);
      if(boxNumbers.has(number)||boxNumbers.size>=200)throw new WmsInputError('箱号重复或超过 200 箱。');boxNumbers.add(number);
      if(!Array.isArray(box.items)||!box.items.length||box.items.length>100)throw new WmsInputError('每箱须有 1-100 条明细。');
      const seen=new Set<string>();
      const items=box.items.map(value=>{
        if(++itemCount>2000)throw new WmsInputError('箱内明细超过 2000 条。');
        const item=object(value);strictKeys(item,['lineId','quantity']);const lineId=requireText(item.lineId,'计划明细');
        const line=byLine.get(lineId),quantity=requirePositiveQuantity(item.quantity);
        if(!line||seen.has(lineId))throw new WmsInputError('箱内明细重复或不属于本计划。');seen.add(lineId);
        const qty=(totals.get(lineId)??0)+quantity;if(qty>line.quantity)throw new WmsInputError('层级分摊数量超过计划。');totals.set(lineId,qty);
        return {lineId,quantity,weight:micros(line.basis)/BigInt(line.quantity)*BigInt(quantity)};
      }).sort((a,b)=>a.lineId.localeCompare(b.lineId));
      return {number,items,weight:items.reduce((n,row)=>n+row.weight,BigInt(0))};
    }).sort((a,b)=>a.number.localeCompare(b.number));
    return {shipmentId,boxes,weight:boxes.reduce((n,row)=>n+row.weight,BigInt(0))};
  }).sort((a,b)=>a.shipmentId.localeCompare(b.shipmentId));
  if(lines.some(line=>totals.get(line.lineId)!==line.quantity))throw new WmsInputError('层级分摊须完整覆盖计划数量。');
  const shares=split(micros(total),shipments.map(row=>({id:row.shipmentId,weight:row.weight})));
  const lineShares=new Map(lines.map(line=>[line.lineId,BigInt(0)]));
  const result=shipments.map(shipment=>{
    const allocated=shares.get(shipment.shipmentId)!;
    const boxShares=split(allocated,shipment.boxes.map(box=>({id:box.number,weight:box.weight})));
    return {shipmentId:shipment.shipmentId,basis:amount(shipment.weight),allocatedAmount:amount(allocated),boxes:shipment.boxes.map(box=>{
      const allocated=boxShares.get(box.number)!;
      const itemShares=split(allocated,box.items.map(item=>({id:item.lineId,weight:item.weight})));
      return {number:box.number,basis:amount(box.weight),allocatedAmount:amount(allocated),items:box.items.map(item=>{
        const allocated=itemShares.get(item.lineId)!;lineShares.set(item.lineId,lineShares.get(item.lineId)!+allocated);
        return {lineId:item.lineId,quantity:item.quantity,basis:amount(item.weight),allocatedAmount:amount(allocated)};
      })};
    })};
  });
  return {shipments:result,lineShares};
}

export function hierarchyInput(saved: ReturnType<typeof allocateCostHierarchy>['shipments']) {
  return {shipments:saved.map(row=>({shipmentId:row.shipmentId,boxes:row.boxes.map(box=>({number:box.number,items:box.items.map(item=>({lineId:item.lineId,quantity:item.quantity}))}))}))};
}
