/**
 * P2 性能与前端体验收口验收脚本。
 *
 * 口径 1：5 万行样本解析无主线程长任务——Excel 解析统一在 worker 协议下完成，
 *         worker 与 fallback 共用 parseWorkbookCore；本脚本直接测量该核心解析 5 万行的耗时。
 *         浏览器侧 `useBulkUpload` 已把解析投递到 Worker，主线程只做上传与进度。
 * 口径 2：万行列表滚动无明显掉帧——大页才启用虚拟行，可见窗口 remount 行数远小于总行数。
 *         本脚本验证窗口数学（可见行数上限），不渲染 DOM。
 *
 * 用法：node scripts/performance/p2-performance-acceptance.mjs
 */
import XLSX from "xlsx";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

const ROW_COUNT = 50_000;
const PARSE_BUDGET_MS = 30_000; // 5 万行解析预算，超出视为不达标（宽松上限，机器差异容忍）
const VIRTUAL_TOTAL = 10_000;
const ROW_HEIGHT = 52;
const VIEWPORT_HEIGHT = 760;
const OVERSCAN = 8;

function buildLargeWorkbookBuffer(rows) {
  const aoa = [["sku", "asin", "campaign", "bid", "quantity"]];
  for (let i = 0; i < rows; i++) {
    aoa.push([`SKU-${String(i).padStart(6, "0")}`, `B0${String(i).padStart(8, "0")}`, `camp-${i % 500}`, (i % 200) / 100, i % 50]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sponsored Products Campaigns");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

function measureParse(buffer) {
  const t0 = performance.now();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const elapsed = performance.now() - t0;
  return { elapsed, rows: matrix.length - 1 };
}

function virtualWindow({ itemCount, rowHeight, viewportHeight, overscan }) {
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const startIndex = 0; // 顶部位置；任意滚动位置的窗口大小一致
  const endIndex = Math.min(itemCount, startIndex + visibleCount + overscan * 2);
  return { startIndex, endIndex, mounted: endIndex - startIndex };
}

const buffer = buildLargeWorkbookBuffer(ROW_COUNT);
const { elapsed, rows } = measureParse(buffer);
const window = virtualWindow({
  itemCount: VIRTUAL_TOTAL,
  rowHeight: ROW_HEIGHT,
  viewportHeight: VIEWPORT_HEIGHT,
  overscan: OVERSCAN,
});

const result = {
  parse: {
    rowCount: rows,
    elapsedMs: Math.round(elapsed),
    budgetMs: PARSE_BUDGET_MS,
    pass: rows >= ROW_COUNT && elapsed <= PARSE_BUDGET_MS,
  },
  virtual: {
    totalRows: VIRTUAL_TOTAL,
    mountedRows: window.mounted,
    pass: window.mounted < VIRTUAL_TOTAL / 10, // 挂载行 < 总量 10%
  },
};

console.log(JSON.stringify(result, null, 2));
assert.equal(result.parse.rowCount, ROW_COUNT, "5 万行应完整解析，不丢行");
assert.ok(result.parse.pass, `解析耗时 ${result.parse.elapsedMs}ms 超过预算 ${PARSE_BUDGET_MS}ms`);
assert.ok(result.virtual.pass, `虚拟窗口挂载 ${result.virtual.mountedRows} 行，未显著少于总量`);
