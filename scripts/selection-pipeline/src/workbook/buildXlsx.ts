import ExcelJS from "exceljs";
import { buildProductExportWorkbook } from "@/lib/products/product-export-job";
import type { Draft } from "../types";
export async function buildXlsx(draft: Draft, target: string) {
  // Use the actual exporter so existing section headers/formulas stay aligned.
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildProductExportWorkbook([draft.product]));
  const sources = workbook.addWorksheet("采集来源与标签");
  sources.addRow(["ASIN", "链接", "采集时间", "BSR", "图片fileId", "本地图片路径（相对选品目录）", "标签", "数量", "估算说明"]);
  for (const c of draft.competitors) {
    const entries = Object.entries(draft.tags.countByAsin[c.asin] ?? {});
    for (const [tag,count] of entries.length ? entries : [["",0]]) sources.addRow([c.asin,c.url,c.capturedAt ?? "",c.bsr ?? "",c.imageFileId ?? "",c.imagePath ?? "",tag,count,"BSR启发式，非真实销量"]);
  }
  const basic = workbook.addWorksheet("基础信息");
  basic.addRow(["SKU", "中文名", "英文名", "状态", "关键词", "目标价下限USD", "目标价上限USD", "备注"]);
  basic.addRow([draft.product.sku,draft.product.chineseName,draft.product.englishName,draft.product.status,draft.brief.keyword,draft.brief.priceMin ?? "",draft.brief.priceMax ?? "",draft.product.note]);
  for (const sheet of [sources,basic]) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach(column => { column.width = 25; column.alignment = { wrapText: true, vertical: "top" }; });
  }
  await workbook.xlsx.writeFile(target);
}
