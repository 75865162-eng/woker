import * as XLSX from "xlsx";

export type BulkSheetRow = Record<string, string | number | boolean | null>;

export type ParsedBulkSheet = {
  sheetName: string;
  rows: BulkSheetRow[];
};

export type ParsedBulkWorkbook = {
  workbookSheets: string[];
  matchedSheets: string[];
  sheets: ParsedBulkSheet[];
  rowCount: number;
};

export type BulkRowChunk = {
  sheetName: string;
  rows: BulkSheetRow[];
  startRowIndex: number;
  progress: number;
};

export const amazonBulkTargetSheets = [
  "商品推广活动",
  "Sponsored Products Campaigns",
  "Bulk Operations",
  "Sponsored Products",
];

function normalizeSheetName(name: string) {
  return name
    .toLowerCase()
    .replace(/\uFEFF/g, "")
    .replace(/[\s()[\]_\-:：，。、\\（）]/g, "");
}

export function bulkSheetMatches(sheetName: string, targetSheets: string[]) {
  const normalized = normalizeSheetName(sheetName);

  return targetSheets.some((target) => {
    const normalizedTarget = normalizeSheetName(target);
    return normalized === normalizedTarget || normalized.includes(normalizedTarget);
  });
}

export function buildRowsWithSourceIndexes(sheet: XLSX.WorkSheet): BulkSheetRow[] {
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
  const rows: BulkSheetRow[] = [];

  for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index];
    const hasValue = row.some((cell) => cell !== null && String(cell).trim() !== "");

    if (!hasValue) {
      continue;
    }

    const record: BulkSheetRow = { __sourceRowIndex: index + 1 };

    headers.forEach((header, columnIndex) => {
      if (header) {
        record[header] = row[columnIndex] ?? null;
      }
    });

    rows.push(record);
  }

  return rows;
}

export function parseBulkWorkbook(input: ArrayBuffer, targetSheets = amazonBulkTargetSheets): ParsedBulkWorkbook {
  const workbook = XLSX.read(input, { type: "array", dense: true });
  const matchedSheets = workbook.SheetNames.filter((name) => bulkSheetMatches(name, targetSheets));
  const sheets = matchedSheets.map((sheetName) => ({
    sheetName,
    rows: buildRowsWithSourceIndexes(workbook.Sheets[sheetName]),
  }));
  const rowCount = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);

  return {
    workbookSheets: workbook.SheetNames,
    matchedSheets,
    sheets,
    rowCount,
  };
}

export function chunkParsedBulkWorkbook(parsedWorkbook: ParsedBulkWorkbook, chunkSize = 1000): BulkRowChunk[] {
  const chunks: BulkRowChunk[] = [];
  let parsedRowCount = 0;

  for (const { sheetName, rows } of parsedWorkbook.sheets) {
    if (rows.length === 0) {
      chunks.push({ sheetName, rows: [], startRowIndex: 0, progress: 100 });
      continue;
    }

    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunkRows = rows.slice(start, start + chunkSize);
      parsedRowCount += chunkRows.length;
      chunks.push({
        sheetName,
        rows: chunkRows,
        startRowIndex: start,
        progress: parsedWorkbook.rowCount > 0 ? Math.min(100, Math.round((parsedRowCount / parsedWorkbook.rowCount) * 100)) : 100,
      });
    }
  }

  return chunks;
}
