import {NextResponse} from 'next/server';
import {requireApiPermission} from '@/lib/auth/api-permissions';
import {workspaceScopeFromRequest} from '@/lib/workspace/scope';
import {previewExternalFinanceSource,importExternalFinanceSource,queryExternalFinanceClaims} from '@/lib/finance/external-source-service';
import {WmsError} from '@/lib/wms/contracts';
import {WmsInputError} from '@/lib/wms/rules';
import {SyncInputError} from '@/lib/amazon-sync/policy';
import {AdsQueryError} from '@/lib/amazon-ads/query-contract';
import {FinanceRuleError} from '@/lib/finance/rules';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store'};
function fail(error:unknown){const expected=error instanceof WmsError||error instanceof WmsInputError||error instanceof SyncInputError||error instanceof AdsQueryError;return NextResponse.json({error:expected?error.message:error instanceof FinanceRuleError?error.message:'外部核算来源服务暂不可用。'},{status:expected?error.status:error instanceof FinanceRuleError?422:500,headers});}
export async function GET(request:Request){const auth=await requireApiPermission('operations','view',request);if(!auth.ok)return auth.response;try{return NextResponse.json(await queryExternalFinanceClaims({organizationId:auth.user.organizationId,workspaceId:workspaceScopeFromRequest(request).workspaceId,actorUserId:auth.user.id},new URL(request.url).searchParams),{headers});}catch(error){return fail(error);}}
export async function POST(request:Request){let body:Record<string,unknown>;try{body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return NextResponse.json({error:'请求内容无效。'},{status:400,headers});}const auth=await requireApiPermission('operations',body.action==='preview'?'view':'create',request);if(!auth.ok)return auth.response;const scope={organizationId:auth.user.organizationId,workspaceId:workspaceScopeFromRequest(request).workspaceId,actorUserId:auth.user.id};try{if(body.action==='preview'){if(Object.keys(body).some(key=>!['action','selector'].includes(key)))throw new WmsError('预览仅接受来源选择范围。',400);return NextResponse.json(await previewExternalFinanceSource(scope,body.selector),{headers});}if(body.action!=='import-draft')throw new WmsError('来源操作无效。',400);const {action:_,...input}=body;void _;return NextResponse.json(await importExternalFinanceSource(scope,input),{headers});}catch(error){return fail(error);}}
