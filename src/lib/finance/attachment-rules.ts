import { WmsError } from '@/lib/wms/contracts';
export const financeAttachmentMaxBytes=10*1024*1024;
export function validateFinanceAttachment(name:string,buffer:Buffer){
 if(!name.trim()||name.length>200||/[\x00-\x1f\\/]/.test(name))throw new WmsError('附件文件名无效。',400);
 if(!buffer.length||buffer.length>financeAttachmentMaxBytes)throw new WmsError('凭证附件须为 1 字节至 10MB。',400);
 const extension=name.toLowerCase().split('.').at(-1);
 if(extension==='pdf'&&buffer.subarray(0,5).toString()==='%PDF-')return {extension:'pdf',mimeType:'application/pdf'};
 if(extension==='png'&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {extension:'png',mimeType:'image/png'};
 if((extension==='jpg'||extension==='jpeg')&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return {extension:'jpg',mimeType:'image/jpeg'};
 throw new WmsError('凭证附件仅接受文件头匹配的 PDF、PNG 或 JPEG。',400);
}
