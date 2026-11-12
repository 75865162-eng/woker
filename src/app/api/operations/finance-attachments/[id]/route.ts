import {NextResponse} from 'next/server';
import {requireApiPermission} from '@/lib/auth/api-permissions';
import {workspaceScopeFromRequest} from '@/lib/workspace/scope';
import {downloadFinanceAttachment} from '@/lib/finance/attachment-service';
import {WmsError} from '@/lib/wms/contracts';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await requireApiPermission('operations','view',request);if(!auth.ok)return auth.response;
 try{const {id}=await params,result=await downloadFinanceAttachment({organizationId:auth.user.organizationId,workspaceId:workspaceScopeFromRequest(request).workspaceId,actorUserId:auth.user.id},id);return new Response(new Uint8Array(result.buffer),{headers:{'Cache-Control':'no-store','Content-Type':result.mimeType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`,'X-Content-Type-Options':'nosniff'}});}catch(error){return NextResponse.json({error:error instanceof WmsError?error.message:'凭证附件读取失败。'},{status:error instanceof WmsError?error.status:500,headers:{'Cache-Control':'no-store'}});}
}
