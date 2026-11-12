import {NextResponse} from 'next/server';
import {readWorkflowOptionEvidence} from '@/lib/fba-local/workflow-options';
import {wmsErrorResponse,wmsRequestScope} from '../wms/_shared';
export const runtime='nodejs';
export async function GET(request:Request){try{const auth=await wmsRequestScope(request);if('response' in auth)return auth.response;const params=new URL(request.url).searchParams;return NextResponse.json(await readWorkflowOptionEvidence(auth.scope,params.get('planId')??'',params.get('snapshotId')??''),{headers:{'Cache-Control':'no-store'}});}catch(error){return wmsErrorResponse(error);}}
