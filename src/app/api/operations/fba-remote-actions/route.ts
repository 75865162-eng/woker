import {NextResponse} from 'next/server';
import {queryRemoteActions,mutateRemoteAction} from '@/lib/fba-local/remote-action-service';
import {readJson,wmsErrorResponse,wmsRequestScope} from '../wms/_shared';
export const runtime='nodejs';
export async function GET(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;return NextResponse.json(await queryRemoteActions(auth.scope,new URL(request.url).searchParams),{headers:{'Cache-Control':'no-store'}});}catch(error){return wmsErrorResponse(error);}}
export async function POST(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;return NextResponse.json(await mutateRemoteAction(auth.scope,await readJson(request)),{headers:{'Cache-Control':'no-store'}});}catch(error){return wmsErrorResponse(error);}}
