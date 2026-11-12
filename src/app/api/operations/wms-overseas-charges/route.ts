import {queryOverseasCharges,mutateOverseasCharge} from '@/lib/wms/overseas-charge-service';
import {wmsRequestScope,wmsErrorResponse,readJson} from '../wms/_shared';
export const runtime='nodejs';
export async function GET(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;return Response.json(await queryOverseasCharges(auth.scope,new URL(request.url).searchParams),{headers:{'Cache-Control':'no-store'}});}catch(error){return wmsErrorResponse(error);}}
export async function POST(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;return Response.json(await mutateOverseasCharge(auth.scope,await readJson(request)),{headers:{'Cache-Control':'no-store'}});}catch(error){return wmsErrorResponse(error);}}
