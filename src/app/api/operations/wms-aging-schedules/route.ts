import {NextResponse} from 'next/server';
import {requireApiPermission} from '@/lib/auth/api-permissions';
import {workspaceScopeFromRequest} from '@/lib/workspace/scope';
import {configureAgingSchedule,queryAgingSchedules} from '@/lib/wms/aging-schedule-service';
import {WmsError} from '@/lib/wms/contracts';
import {WmsInputError} from '@/lib/wms/rules';
export const runtime='nodejs';
function fail(error:unknown){return NextResponse.json({error:error instanceof WmsError||error instanceof WmsInputError?error.message:'库龄快照服务暂不可用。'},{status:error instanceof WmsError||error instanceof WmsInputError?error.status:500});}
export async function GET(request:Request){const auth=await requireApiPermission('wms','view',request);if(!auth.ok)return auth.response;try{return NextResponse.json(await queryAgingSchedules({organizationId:auth.user.organizationId,workspaceId:workspaceScopeFromRequest(request).workspaceId,actorUserId:auth.user.id}),{headers:{'Cache-Control':'no-store'}});}catch(error){return fail(error);}}
export async function POST(request:Request){const auth=await requireApiPermission('wms','approve',request);if(!auth.ok)return auth.response;try{return NextResponse.json(await configureAgingSchedule({organizationId:auth.user.organizationId,workspaceId:workspaceScopeFromRequest(request).workspaceId,actorUserId:auth.user.id},await request.json()),{headers:{'Cache-Control':'no-store'}});}catch(error){return fail(error);}}
