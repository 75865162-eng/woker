import type {WmsCommand} from '@prisma/client';
import {scoped} from './access';
import type {WmsScope} from './contracts';
import type {Tx} from './repository';
import {queryStockContexts} from './stock-context-query';
import {availableQuantity} from './rules';
export async function presentConversions(tx:Tx,scope:WmsScope,commands:WmsCommand[]){
 const results=commands.map(command=>({command,result:command.result as {targetBalanceId:string;conversion:{quantity:number;reason:string;sourceLotId:string;targetLotId:string}}}));
 const balances=await tx.wmsStockBalance.findMany({where:{...scoped(scope),id:{in:results.map(row=>row.result.targetBalanceId)}}});
 const byBalance=new Map(balances.map(balance=>[balance.id,balance]));
 const contexts=await queryStockContexts(tx,scope,results.flatMap(row=>[row.command.aggregateId,row.result.targetBalanceId]));
 const reversals=commands.length?await tx.wmsCommand.findMany({where:{...scoped(scope),action:'SKU_CONVERSION_REVERSE',OR:commands.map(command=>({result:{path:['reversesCommandId'],equals:command.id}}))},select:{id:true,result:true}}):[];
 const byOriginal=new Map(reversals.map(row=>[(row.result as {reversesCommandId:string}).reversesCommandId,row.id]));
 return results.map(({command,result})=>{const balance=byBalance.get(result.targetBalanceId),reversal=byOriginal.get(command.id);return {id:command.id,createdAt:command.createdAt,createdBy:command.actorUserId,conversion:result.conversion,source:contexts.get(command.aggregateId)??null,target:contexts.get(result.targetBalanceId)??null,targetBalanceRevision:balance?.revision??null,reversalCommandId:reversal??null,canRequestReversal:!reversal&&command.actorUserId===scope.actorUserId&&!!balance&&availableQuantity(balance)>=result.conversion.quantity};});
}
