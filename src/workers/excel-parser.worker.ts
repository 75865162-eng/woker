import * as XLSX from "xlsx";
import { parseWorkbookCore } from "@/lib/excel/workbook-parse-core";

type SheetRow = Record<string, string | number | boolean | null>;

/**
 * 统一 Excel 解析 Worker。
 *
 * 所有浏览器侧的 XLSX.read 都应走这里，避免大文件（如 50MB）在 UI 主线程同步解析
 * 造成卡顿，同时消除「worker + 主线程」两套解析链。
 *
 * 支持两种协议：
 *  - bulk：Amazon Bulk Operations 分片解析（targetSheets 匹配 + chunk 流式回传）
 *  - generic：一次性解析首个/全部 sheet 为二维数组或对象数组，供商品导入、
 *    Overall 数据、分组状态等场景使用。
 */

type BulkParseMessage = {
  mode?: "bulk";
  file: ArrayBuffer;
  targetSheets: string[];
  chunkSize?: number;
};

type GenericParseMessage = {
  mode: "generic";
  file: ArrayBuffer;
  /** matrix: 二维数组（header:1）；objects: 对象数组 */
  shape: "matrix" | "objects";
  /** objects 模式是否合并全部 sheet；matrix 模式固定取首个 sheet */
  allSheets?: boolean;
  cellDates?: boolean;
  raw?: boolean;
  defval?: string | number | boolean | null;
  blankrows?: boolean;
};

type ParseMessage = BulkParseMessage | GenericParseMessage;

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\uFEFF/g, "")
    .replace(/[\s()[\]_\-:：,，.。/\\（）]/g, "");
}

function sheetMatches(sheetName: string, targetSheets: string[]) {
  const normalized = normalizeName(sheetName);

  return targetSheets.some((target) => {
    const normalizedTarget = normalizeName(target);
    return normalized === normalizedTarget || normalized.includes(normalizedTarget);
  });
}

function buildRowsWithSourceIndexes(sheet: XLSX.WorkSheet): SheetRow[] {
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
  });
  const headerRowIndex = matrix.findIndex((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));

  if (headerRowIndex < 0) {
    return [];
  }

  const headers = matrix[headerRowIndex].map((cell, index) => String(cell ?? `__EMPTY_${index}`).trim());
  const rows: SheetRow[] = [];

  for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index];
    const hasValue = row.some((cell) => cell !== null && String(cell).trim() !== "");

    if (!hasValue) {
      continue;
    }

    const record: SheetRow = { __sourceRowIndex: index + 1 };

    headers.forEach((header, columnIndex) => {
      if (header) {
        record[header] = row[columnIndex] ?? null;
      }
    });

    rows.push(record);
  }

  return rows;
}

function handleBulk({ file, targetSheets, chunkSize = 1000 }: BulkParseMessage) {
  const workbook = XLSX.read(file, { type: "array", dense: true });
  const matchedSheets = workbook.SheetNames.filter((name) => sheetMatches(name, targetSheets));

  postMessage({ type: "start", sheets: matchedSheets, workbookSheets: workbook.SheetNames });

  if (matchedSheets.length === 0) {
    postMessage({
      type: "error",
      message: `未找到可解析的 Amazon Bulk Operations Sheet。当前文件包含：${workbook.SheetNames.join("、") || "无"}`,
    });
    return;
  }

  let parsedRowCount = 0;
  const sheetRows = matchedSheets.map((sheetName) => ({
    sheetName,
    rows: buildRowsWithSourceIndexes(workbook.Sheets[sheetName]),
  }));
  const totalRows = sheetRows.reduce((sum, sheet) => sum + sheet.rows.length, 0);

  for (const { sheetName, rows } of sheetRows) {
    if (rows.length === 0) {
      postMessage({ type: "chunk", sheetName, start: 0, rows: [], progress: 100 });
      continue;
    }

    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunkRows = rows.slice(start, start + chunkSize);
      parsedRowCount += chunkRows.length;

      postMessage({
        type: "chunk",
        sheetName,
        start,
        rows: chunkRows,
        startRowIndex: start,
        progress: totalRows > 0 ? Math.min(100, Math.round((parsedRowCount / totalRows) * 100)) : 100,
      });
    }
  }

  postMessage({ type: "complete", rowCount: parsedRowCount, sheets: matchedSheets });
}

function handleGeneric(message: GenericParseMessage) {
  const { file, shape, allSheets, cellDates, raw, defval, blankrows } = message;
  const result = parseWorkbookCore(file, {
    shape,
    ...(allSheets === undefined ? {} : { allSheets }),
    ...(cellDates === undefined ? {} : { cellDates }),
    ...(raw === undefined ? {} : { raw }),
    ...(defval === undefined ? {} : { defval }),
    ...(blankrows === undefined ? {} : { blankrows }),
  });
  postMessage({ type: "generic", shape, rows: result.rows, sheetNames: result.sheetNames });
}

self.onmessage = (event: MessageEvent<ParseMessage>) => {
  const message = event.data;

  try {
    if (message.mode === "generic") {
      handleGeneric(message);
    } else {
      handleBulk(message);
    }
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Excel 解析失败",
    });
  }
};

export {};
