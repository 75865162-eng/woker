import assert from "node:assert/strict";
import test from "node:test";
import { initialState } from "../src/components/logistics/use-logistics-workbench-model";
import { buildLogisticsTaskSummary, getVisibleLogisticsRows, logisticsToneForLog } from "../src/components/logistics/logistics-workbench-tables";
import type { LogisticsWorkspaceState } from "../src/lib/logistics/types";

function state(overrides: Partial<LogisticsWorkspaceState> = {}): LogisticsWorkspaceState {
  const defaults: LogisticsWorkspaceState = {
    ...initialState,
    aSummary: {
      latestSheetName: "fixture",
      totalRows: 2,
      totalBoxes: 2,
      totalShipment: 8,
      boxHeaders: [1, 2],
      boxWeightKgMap: {},
      boxLengthCmMap: {},
      boxWidthCmMap: {},
      boxHeightCmMap: {},
      rows: [
        { rowIndex: 1, image: "", productName: "active", asin: "", fnsku: "", sku: "A", packageSize: "", packageWeightKg: null, hsCode: "", purchaseCost: null, totalShipment: 8, boxMap: { 1: 3, 2: 5 } },
        { rowIndex: 2, image: "", productName: "zero", asin: "", fnsku: "", sku: "B", packageSize: "", packageWeightKg: null, hsCode: "", purchaseCost: null, totalShipment: 0, boxMap: {} },
      ],
    },
  };
  return { ...defaults, ...overrides };
}

test("物流纯展示模型只汇总正发货行并保留缺省标签", () => {
  const current = state({
    pdfSummaries: [{ fileNameBase: "fixture", shipmentTitle: "货件", shipmentName: "S1", warehouseCode: "WH", fbaCode: "FBA", totalBoxes: 2, channelName: "海运", renamedFileName: "fixture.pdf", pages: [{ pageNumber: 1, shipmentName: "S1", warehouseCode: "WH", fbaCode: "FBA", totalBoxes: 2, fbaBoxCode: "", positionCode: "", skuType: "", sku: "", qty: null }] }],
    logs: [{ id: "1", level: "warning", message: "warn" }, { id: "2", level: "error", message: "error" }],
  });
  assert.deepEqual(getVisibleLogisticsRows(current).map((row) => row.sku), ["A"]);
  assert.deepEqual(buildLogisticsTaskSummary(current), {
    shipmentTitle: "货件", shipmentName: "S1", warehouseCode: "WH", fbaCode: "FBA", boxCount: 2,
    skuCount: 1, totalShipment: 8, pdfCount: 1, pdfPageCount: 1, warningCount: 1, errorCount: 1,
  });
  assert.equal(logisticsToneForLog("success"), "green");
  assert.equal(logisticsToneForLog("warning"), "amber");
  assert.equal(logisticsToneForLog("error"), "red");
  assert.equal(logisticsToneForLog("info"), "blue");
});

test("物流摘要没有 A 表或 PDF 时返回空视图状态，不制造计数", () => {
  const current = state({ aSummary: null, pdfSummaries: [], logs: [] });
  assert.deepEqual(getVisibleLogisticsRows(current), []);
  assert.deepEqual(buildLogisticsTaskSummary(current), {
    shipmentTitle: "--", shipmentName: "--", warehouseCode: "--", fbaCode: "--", boxCount: 0,
    skuCount: 0, totalShipment: 0, pdfCount: 0, pdfPageCount: 0, warningCount: 0, errorCount: 0,
  });
});
