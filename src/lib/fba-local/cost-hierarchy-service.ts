import type {FbaLocalPlan} from '@prisma/client';
import {scoped} from '@/lib/wms/access';
import type {WmsScope} from '@/lib/wms/contracts';
import {WmsError} from '@/lib/wms/contracts';
import type {Tx} from '@/lib/wms/repository';
import {parseLocalPacking} from './packing';
import type {allocateLocalCost} from './cost-allocation';

/** Caller holds the plan lock; packing and shipment links mutate under that same lock. */
export async function validateCostHierarchy(tx:Tx,scope:WmsScope,plan:FbaLocalPlan&{lines:{id:string;quantity:number}[]},allocation:ReturnType<typeof allocateLocalCost>){
  if(!allocation.hierarchy)return;
  if(plan.packing===null)throw new WmsError('分层分摊须先保存装箱资料。',409);
  const packing=parseLocalPacking(plan.packing,plan.lines),byBox=new Map(packing.boxes.map(box=>[box.number,box]));
  const shipments=await tx.fbaLocalShipment.findMany({where:{...scoped(scope),planId:plan.id},include:{items:true}});
  const seen=new Set<string>();
  for(const shipment of allocation.hierarchy.shipments){
    const linked=shipments.find(row=>row.id===shipment.shipmentId);
    if(!linked)throw new WmsError('分摊货件不属于当前计划。',409);
    const expected=new Map<string,number>(),actual=new Map<string,number>();
    for(const item of linked.items)expected.set(item.planLineId,(expected.get(item.planLineId)??0)+item.quantity);
    for(const box of shipment.boxes){
      const packed=byBox.get(box.number);
      if(!packed||seen.has(box.number)||packed.items.length!==box.items.length||packed.items.some((item,i)=>item.lineId!==box.items[i].lineId||item.quantity!==box.items[i].quantity))throw new WmsError('分摊箱须与已保存装箱明细完全一致。',409);
      seen.add(box.number);
      for(const item of box.items)actual.set(item.lineId,(actual.get(item.lineId)??0)+item.quantity);
    }
    if(expected.size!==actual.size||[...expected].some(([id,qty])=>actual.get(id)!==qty))throw new WmsError('货件分箱数量须与已关联的 Amazon 明细数量一致。',409);
  }
  if(seen.size!==packing.boxes.length)throw new WmsError('分层分摊须覆盖全部装箱资料。',409);
}
