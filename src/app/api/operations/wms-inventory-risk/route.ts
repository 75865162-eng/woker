import {prisma} from '@/lib/db/prisma';
import {queryInventoryRisk,mutateInventoryRisk} from '@/lib/wms/inventory-risk-service';
import {inventoryRiskCsv} from '@/lib/wms/inventory-risk-export';
import {authorizeWms,auditWms} from '@/lib/wms/access';
import {WmsError} from '@/lib/wms/contracts';
import {readJson,wmsErrorResponse,wmsRequestScope} from '../wms/_shared';
export const runtime='nodejs';
export async function GET(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;const params=new URL(request.url).searchParams,result=await queryInventoryRisk(auth.scope,params);if(params.get('format')==='csv'){
 if(!params.get('id')||!result.items[0])throw new WmsError('导出须选择有效评估 ID。',404);
 await prisma.$transaction(async tx=>{await authorizeWms(tx,auth.scope,'view');await auditWms(tx,auth.scope,'inventory-risk.export',result.items[0].id,{format:'csv',requestHash:result.items[0].requestHash});});
 return new Response(inventoryRiskCsv(result.items[0]),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="inventory-risk.csv"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }return Response.json(result,{headers:{'Cache-Control':'no-store'}});}catch(error){return wmsErrorResponse(error);}}
export async function POST(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;return Response.json(await mutateInventoryRisk(auth.scope,await readJson(request)),{headers:{'Cache-Control':'no-store'}});}catch(error){return wmsErrorResponse(error);}}
