import {NextResponse} from 'next/server';
import {requireApiPermission} from '@/lib/auth/api-permissions';
import {workspaceScopeFromRequest} from '@/lib/workspace/scope';
import {queryFxRevaluations,mutateFxRevaluation} from '@/lib/finance/fx-revaluation-service';
import {WmsError} from '@/lib/wms/contracts';
import {WmsInputError} from '@/lib/wms/rules';
import {SyncInputError} from '@/lib/amazon-sync/policy';
export const runtime='nodejs';const headers={'Cache-Control':'no-store'};
function fail(error:unknown){const expected=error instanceof WmsError||error instanceof WmsInputError||error instanceof SyncInputError;return NextResponse.json({error:expected?error.message:'重估服务暂不可用。'},{status:expected?error.status:500,headers});}
export async function GET(request:Request){const auth=await requireApiPermission('operations','view',request);if(!auth.ok)return auth.response;try{return NextResponse.json(await queryFxRevaluations({organizationId:auth.user.organizationId,workspaceId:workspaceScopeFromRequest(request).workspaceId,actorUserId:auth.user.id},new URL(request.url).searchParams),{headers});}catch(error){return fail(error);}}
export async function POST(request:Request){let body:Record<string,unknown>;try{body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return NextResponse.json({error:'请求内容无效。'},{status:400,headers});}const auth=await requireApiPermission('operations',body.action==='review-revaluation'?'approve':'create',request);if(!auth.ok)return auth.response;try{return NextResponse.json(await mutateFxRevaluation({organizationId:auth.user.organizationId,workspaceId:workspaceScopeFromRequest(request).workspaceId,actorUserId:auth.user.id},body),{headers});}catch(error){return fail(error);}}
