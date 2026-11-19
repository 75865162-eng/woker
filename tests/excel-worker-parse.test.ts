import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseWorkbookCore } from "../src/lib/excel/workbook-parse-core";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function makeWorkbook(rows: unknown[][]): ArrayBuffer {
  // 用 core 依赖的同一 xlsx 构造 fixture，避免额外 mock。
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

test("Excel 解析统一走 worker 客户端，三处浏览器调用点不再直接 XLSX.read", () => {
  const product = read("../src/components/products/product-workbench-data.ts");
  const campaign = read("../src/components/workspace/campaign-grid-home-utils.ts");

  for (const [name, src] of [["product-workbench-data", product], ["campaign-grid-home-utils", campaign]] as const) {
    assert.match(src, /parseWorkbookInWorker/, `${name} 应通过统一 worker 客户端解析`);
    assert.doesNotMatch(src, /XLSX\.read\(/, `${name} 不应再在主线程直接 XLSX.read`);
  }
});

test("worker 支持 generic 通用解析协议，与 bulk 分片协议并存", () => {
  const worker = read("../src/workers/excel-parser.worker.ts");
  assert.match(worker, /mode === "generic"/);
  assert.match(worker, /parseWorkbookCore/);
  assert.match(worker, /handleBulk/);
  // worker 与 fallback 共用同一份解析核心，杜绝两套解析链。
  assert.match(worker, /from "@\/lib\/excel\/workbook-parse-core"/);
});

test("解析核心 matrix 模式返回二维数组并保留首个 sheet 契约", () => {
  const buffer = makeWorkbook([
    ["品名", "数量"],
    ["A", 2],
    ["", ""],
  ]);
  const result = parseWorkbookCore(buffer, { shape: "matrix", defval: "", raw: false, blankrows: false });
  assert.equal(result.sheetNames[0], "Sheet1");
  assert.ok(Array.isArray(result.rows));
  assert.equal((result.rows as unknown[][])[0][0], "品名");
});

test("解析核心 objects 模式合并全部 sheet 且映射表头为键", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["sku", "qty"], ["S1", 3]]), "One");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["sku", "qty"], ["S2", 5]]), "Two");
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  const result = parseWorkbookCore(buffer, { shape: "objects", allSheets: true, defval: "", raw: true });
  assert.equal(result.sheetNames.length, 2);
  const rows = result.rows as Record<string, unknown>[];
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.sku === "S1"));
  assert.ok(rows.some((row) => row.sku === "S2"));
});

test("解析核心区分缺失零与真实数值（回归 system-health 契约）", () => {
  for (const value of ["", 0, 2.5]) {
    const buffer = makeWorkbook([["数值"], [value]]);
    const result = parseWorkbookCore(buffer, { shape: "matrix", raw: false, defval: "", blankrows: false });
    const rows = result.rows as unknown[][];
    // raw:false 下统一转字符串，缺失为空串、0 为 "0"。
    assert.equal(String(rows[1][0]), value === "" ? "" : String(value));
  }
});
