import {NextResponse} from 'next/server';
import {requireApiPermission} from '@/lib/auth/api-permissions';
import {workspaceScopeFromRequest} from '@/lib/workspace/scope';
import {mutateVoucherImport} from '@/lib/finance/voucher-import-service';
import {parseVoucherWorkbook} from '@/lib/finance/voucher-workbook';
import {WmsError} from '@/lib/wms/contracts';
import {WmsInputError,requireText} from '@/lib/wms/rules';
export const runtime='nodejs';
export async function POST(request:Request){
 const auth=await requireApiPermission('operations','create',request);if(!auth.ok)return auth.response;
 try{if(Number(request.headers.get('content-length'))>5*1024*1024+65536)throw new WmsError('凭证模板不能超过 5MB。',413);const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.xlsx')||file.size>5*1024*1024)throw new WmsError('请选择不超过 5MB 的 XLSX 模板。',400);
 const records=await parseVoucherWorkbook(Buffer.from(await file.arrayBuffer()));
 return NextResponse.json(await mutateVoucherImport({organizationId:auth.user.organizationId,workspaceId:workspaceScopeFromRequest(request).workspaceId,actorUserId:auth.user.id},{action:'stage-import',bookId:requireText(form.get('bookId'),'账套 ID'),sourceName:file.name,evidence:requireText(form.get('evidence'),'导入依据'),idempotencyKey:requireText(form.get('idempotencyKey'),'幂等键'),records}),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({error:error instanceof WmsError||error instanceof WmsInputError?error.message:'凭证模板读取失败。'},{status:error instanceof WmsError||error instanceof WmsInputError?error.status:500});}
}
