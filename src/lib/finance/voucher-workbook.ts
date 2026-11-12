import ExcelJS from 'exceljs';
import {WmsError} from '@/lib/wms/contracts';
import {parseVoucherImportRows} from './voucher-import-rules';
const fields=['voucherKey','date','subjectCode','debit','credit','memo'] as const;
/** Single explicit template, not heuristic aliases. Formulas and lossy money cells are rejected. */
export async function parseVoucherWorkbook(buffer:Buffer){
 if(buffer.length===0||buffer.length>5*1024*1024)throw new WmsError('凭证工作簿须为 1 字节至 5MB。',400);
 const zip=(await import('jszip')).default;const archive=await zip.loadAsync(buffer);let expanded=0;
 for(const entry of Object.values(archive.files)){
  if(!entry.dir){const size=(entry as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize;if(typeof size!=='number')throw new WmsError('无法核实工作簿解压大小。',400);expanded+=size;if(expanded>25*1024*1024||Object.keys(archive.files).length>1000)throw new WmsError('工作簿展开内容过大。',413);}
 }
 const workbook=new ExcelJS.Workbook();try{await workbook.xlsx.load(buffer as never);}catch{throw new WmsError('无法读取 XLSX 凭证模板。',400);}
 if(workbook.worksheets.length!==1)throw new WmsError('凭证模板须恰有一张 sheet。',400);
 const sheet=workbook.worksheets[0];if(sheet.rowCount>1001||sheet.columnCount>6)throw new WmsError('模板最多 1000 行数据及 6 列。',400);
 for(let index=0;index<fields.length;index++)if(sheet.getRow(1).getCell(index+1).value!==fields[index])throw new WmsError('模板表头须为 voucherKey,date,subjectCode,debit,credit,memo。',400);
 const records:unknown[]=[];
 for(let number=2;number<=sheet.rowCount;number++){
  const row=sheet.getRow(number);if(!row.hasValues)continue;const values:Record<string,unknown>={sourceRow:number,sourceSheet:sheet.name};
  fields.forEach((field,index)=>{const value=row.getCell(index+1).value;
   if(field==='memo'&&(value==null||value===''))values[field]='';
   else if(typeof value==='string')values[field]=value;
   else throw new WmsError(`第 ${number} 行 ${field} 须为文本单元格；日期/金额须明确文本，禁止公式和数字精度猜测。`,400);
  });records.push(values);
 }
 return parseVoucherImportRows(records);
}
