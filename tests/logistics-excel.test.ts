import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { parseAWorkbookBuffer } from "@/lib/logistics/excel";

test("A表跳过末尾空 sheet，读取包含业务表头的 sheet", async () => {
  const workbook = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.aoa_to_sheet([
    [],
    [],
    [],
    ["产品图片", "品名", "ASIN", "FNSKU", "Sku", "包装尺寸（cm）", "包装重量（kg）", "海关编码", "发货总数", 1, 2],
    [null, "测试商品", "B0TEST", "X0TEST", "TEST-SKU", "10*10*10", 1.2, "123456", 12, 5, 7],
  ]);

  XLSX.utils.book_append_sheet(workbook, dataSheet, "9.21us发");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[]]), "Sheet1");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[]]), "Sheet2");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[]]), "Sheet3");

  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const summary = await parseAWorkbookBuffer({ buffer, fileName: "10.14.xlsx" }, { skipImages: true });

  assert.equal(summary.latestSheetName, "9.21us发");
  assert.equal(summary.totalRows, 1);
  assert.equal(summary.totalShipment, 12);
  assert.equal(summary.rows[0]?.sku, "TEST-SKU");
});
