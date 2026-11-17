import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { buildComparisonWorkbook, parseAWorkbookBuffer } from "@/lib/logistics/excel";
import ExcelJS from "exceljs";
import type { AWorkbookSummary, PdfSummary } from "@/lib/logistics/types";

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

test("货件对比导出按标签箱号匹配仓库而非 PDF 页码", async (t) => {
  const template = new ExcelJS.Workbook();
  template.addWorksheet("优化货件");
  const buffer = await template.xlsx.writeBuffer();
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(buffer)));
  const summary: AWorkbookSummary = {
    latestSheetName: "fixture", totalRows: 0, totalBoxes: 1, totalShipment: 0,
    boxHeaders: [12], boxWeightKgMap: { 12: 2 }, boxLengthCmMap: {},
    boxWidthCmMap: {}, boxHeightCmMap: {}, rows: [],
  };
  const pdf: PdfSummary = {
    fileNameBase: "fixture", shipmentTitle: "fixture", shipmentName: "shipment",
    warehouseCode: "warehouse", fbaCode: "fba", totalBoxes: 1, channelName: "channel",
    renamedFileName: "fixture.pdf", pages: [{ pageNumber: 1, positionCode: "P1-B12",
      shipmentName: "shipment-12", warehouseCode: "warehouse-12", fbaCode: "fba",
      totalBoxes: 1, fbaBoxCode: "box", skuType: "", sku: "", qty: null }],
  };
  const result = await buildComparisonWorkbook(summary, [pdf]);
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(result.data);
  const sheet = exported.getWorksheet("优化货件")!;
  assert.equal(sheet.getCell("E3").value, "warehouse-12");
  assert.equal(sheet.getCell("E4").value, "shipment-12");
  assert.equal(sheet.getCell("E5").value, "P1-B12");
});
