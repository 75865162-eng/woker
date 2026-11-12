import {NextResponse} from 'next/server';
import {requireApiPermission} from '@/lib/auth/api-permissions';
import {workspaceScopeFromRequest} from '@/lib/workspace/scope';
import {queryFinanceAttachments,uploadFinanceAttachment} from '@/lib/finance/attachment-service';
import {financeAttachmentMaxBytes} from '@/lib/finance/attachment-rules';
import {WmsError} from '@/lib/wms/contracts';
import {WmsInputError,requireText} from '@/lib/wms/rules';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store'};
function fail(error:unknown){return NextResponse.json({error:error instanceof WmsError||error instanceof WmsInputError?error.message:'凭证附件服务暂不可用。'},{status:error instanceof WmsError||error instanceof WmsInputError?error.status:500,headers});}
export async function GET(request:Request){
 const auth=await requireApiPermission('operations','view',request);if(!auth.ok)return auth.response;
 try{return NextResponse.json(await queryFinanceAttachments({organizationId:auth.user.organizationId,workspaceId:workspaceScopeFromRequest(request).workspaceId,actorUserId:auth.user.id},requireText(new URL(request.url).searchParams.get('voucherId'),'凭证 ID')),{headers});}catch(error){return fail(error);}
}
export async function POST(request:Request){
 const auth=await requireApiPermission('operations','create',request);if(!auth.ok)return auth.response;
 try{
  const declared=Number(request.headers.get('content-length'));if(Number.isFinite(declared)&&declared>financeAttachmentMaxBytes+65536)throw new WmsError('凭证附件不能超过 10MB。',413);
  const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||file.size>financeAttachmentMaxBytes)throw new WmsError('须上传不超过 10MB 的凭证附件。',400);
  const result=await uploadFinanceAttachment({organizationId:auth.user.organizationId,workspaceId:workspaceScopeFromRequest(request).workspaceId,actorUserId:auth.user.id},{voucherId:requireText(form.get('voucherId'),'凭证 ID'),revision:Number(form.get('revision')),evidence:requireText(form.get('evidence'),'附件依据',1000),name:file.name,buffer:Buffer.from(await file.arrayBuffer())});
  return NextResponse.json(result,{status:201,headers});
 }catch(error){return fail(error);}
}
