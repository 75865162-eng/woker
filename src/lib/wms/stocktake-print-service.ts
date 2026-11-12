import {prisma} from '@/lib/db/prisma';
import {queryWms} from './query-service';
import {authorizeWms,auditWms} from './access';
import {WmsError,type WmsScope} from './contracts';
import {requireText} from './rules';
import {renderStocktakePrint} from './stocktake-print';
export async function exportStocktakePrint(scope:WmsScope,id:string){
 const stocktakeId=requireText(id,'盘点单 ID'),result=await queryWms(scope,'stocktakes',new URLSearchParams({id:stocktakeId,limit:'1'}));
 if(!result.items[0])throw new WmsError('盘点单不存在。',404);
 const document=renderStocktakePrint(result.items[0]);
 await prisma.$transaction(async tx=>{await authorizeWms(tx,scope,'view');await auditWms(tx,scope,'stocktake.print',stocktakeId,{revision:document.document.revision,blind:document.document.blind,status:document.document.status,baselineExported:!document.document.blind});});
 return document.html;
}
