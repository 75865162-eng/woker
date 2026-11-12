import {queryCustomsProfiles,mutateCustomsProfile} from '@/lib/fba-local/customs-profile-service';
import {wmsRequestScope,wmsErrorResponse,readJson} from '../wms/_shared';
export const runtime='nodejs';
export async function GET(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;return Response.json(await queryCustomsProfiles(auth.scope,new URL(request.url).searchParams),{headers:{'Cache-Control':'no-store'}});}catch(error){return wmsErrorResponse(error);}}
export async function POST(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;return Response.json(await mutateCustomsProfile(auth.scope,await readJson(request)),{headers:{'Cache-Control':'no-store'}});}catch(error){return wmsErrorResponse(error);}}
