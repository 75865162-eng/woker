import * as XLSX from "xlsx";

type ParseMessage = {
  file: ArrayBuffer;
  targetSheets: string[];
  chunkSize?: number;
};

type SheetRow = Record<string, string | number | boolean | null>;

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

self.onmessage = (event: MessageEvent<ParseMessage>) => {
  const { file, targetSheets, chunkSize = 1000 } = event.data;

  try {
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
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Excel 解析失败",
    });
  }
};

export {};
