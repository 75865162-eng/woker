import {createHash,randomUUID} from 'node:crypto';
import {prisma} from '@/lib/db/prisma';
import {getStorageDriver,getStorageType} from '@/lib/storage';
import type {StorageDriver} from '@/lib/storage/types';
import type {FileStorageType} from '@prisma/client';
import type {WmsScope} from '@/lib/wms/contracts';
import {WmsError} from '@/lib/wms/contracts';
import {scoped} from '@/lib/wms/access';
import {requireRevision,requireText} from '@/lib/wms/rules';
import {financeAttachmentMaxBytes,validateFinanceAttachment} from './attachment-rules';
export async function queryFinanceAttachments(scope:WmsScope,voucherId:string){
 return {attachments:await prisma.financeVoucherAttachment.findMany({where:{...scoped(scope),voucherId},select:{id:true,voucherId:true,contentHash:true,evidence:true,createdBy:true,createdAt:true,file:{select:{originalName:true,mimeType:true,size:true}}},orderBy:[{createdAt:'asc'},{id:'asc'}],take:100})};
}
export async function uploadFinanceAttachment(scope:WmsScope,input:{voucherId:string;revision:number;evidence:string;name:string;buffer:Buffer},storage:StorageDriver=getStorageDriver(),storageType:FileStorageType=getStorageType()){
 const voucherId=requireText(input.voucherId,'凭证 ID'),revision=requireRevision(input.revision),evidence=requireText(input.evidence,'附件依据',1000),format=validateFinanceAttachment(input.name,input.buffer),contentHash=createHash('sha256').update(input.buffer).digest('hex');
 const initial=await prisma.financeVoucher.findFirst({where:{...scoped(scope),id:voucherId},select:{bookId:true,status:true,kind:true,revision:true,period:{select:{status:true}}}});
 if(!initial||initial.status!=='DRAFT'||initial.kind!=='STANDARD'||initial.revision!==revision||initial.period.status!=='OPEN')throw new WmsError('仅当前版本开放期间普通凭证草稿可添加附件。',409);
 const fileId=randomUUID(),id=randomUUID(),key=`finance-evidence/${randomUUID()}.${format.extension}`;
 await storage.putBuffer({key,buffer:input.buffer,contentType:format.mimeType});
 try{
  return await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${initial.bookId} FOR UPDATE`;
   const voucher=await tx.financeVoucher.findFirst({where:{...scoped(scope),id:voucherId},include:{period:true}});
   if(!voucher||voucher.status!=='DRAFT'||voucher.kind!=='STANDARD'||voucher.revision!==revision||voucher.period.status!=='OPEN')throw new WmsError('凭证或期间已变化，请刷新。',409);
   if(await tx.financeVoucherAttachment.count({where:{...scoped(scope),voucherId}})>=20)throw new WmsError('单凭证最多 20 个附件。',422);
   if(await tx.financeVoucherAttachment.findFirst({where:{...scoped(scope),voucherId,contentHash}}))throw new WmsError('凭证已包含相同内容附件。',409);
   await tx.fileObject.create({data:{id:fileId,...scoped(scope),userId:scope.actorUserId,originalName:input.name,mimeType:format.mimeType,size:input.buffer.length,storageKey:key,storageType,status:'done',contentHash}});
   const attachment=await tx.financeVoucherAttachment.create({data:{id,...scoped(scope),bookId:voucher.bookId,voucherId,fileId,contentHash,evidence,createdBy:scope.actorUserId}});
   const updated=await tx.financeVoucher.update({where:{id:voucherId},data:{revision:{increment:1}}});
   await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'finance.attachment.upload',entityType:'FinanceVoucher',entityId:voucherId,metadata:{workspaceId:scope.workspaceId,attachmentId:id,contentHash,evidence,revision:updated.revision}}});
   return {attachment,voucher:updated};
  });
 }catch(error){
  // A lost commit response must never delete a file that may already be bound.
  try{if(!await prisma.financeVoucherAttachment.findUnique({where:{id},select:{id:true}}))await storage.delete(key);}catch{console.error('[finance.attachment.orphan-check]',{attachmentId:id});}
  throw error;
 }
}
export async function downloadFinanceAttachment(scope:WmsScope,id:string,storage:StorageDriver=getStorageDriver(),storageType:FileStorageType=getStorageType()){
 const attachment=await prisma.financeVoucherAttachment.findFirst({where:{...scoped(scope),id},include:{file:true}});
 if(!attachment)throw new WmsError('凭证附件不存在。',404);
 if(attachment.file.storageType!==storageType||!storage.getBoundedBuffer)throw new WmsError('当前存储适配器无法受控读取该附件。',503);
 const buffer=await storage.getBoundedBuffer(attachment.file.storageKey,financeAttachmentMaxBytes);
 if(createHash('sha256').update(buffer).digest('hex')!==attachment.contentHash)throw new WmsError('凭证附件完整性校验失败。',409);
 await prisma.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'finance.attachment.download',entityType:'FinanceVoucher',entityId:attachment.voucherId,metadata:{workspaceId:scope.workspaceId,attachmentId:id,contentHash:attachment.contentHash}}});
 return {name:attachment.file.originalName,mimeType:attachment.file.mimeType??'application/octet-stream',buffer};
}
