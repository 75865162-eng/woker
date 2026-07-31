import type { SaihuExcelDiffResult, SaihuExcelDiffRow } from "@/lib/saihu-search-merge/types";

type XlsxWorksheet = import("xlsx").WorkSheet;
type XlsxCellAddress = import("xlsx").CellAddress;

const diffPreviewRowLimit = 1000;

interface ParsedSheet {
  sheetName: string;
  columns: string[];
  rows: Array<{
    rowNumber: number;
    values: Record<string, string>;
  }>;
}

interface ParsedWorkbook {
  fileName: string;
  sheets: ParsedSheet[];
}

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value).trim();
}

function toCellText(cell: XlsxWorksheet[string] | undefined) {
  if (!cell) {
    return "";
  }

  if (cell.v instanceof Date) {
    return cell.v.toISOString();
  }

  if (cell.v !== null && cell.v !== undefined) {
    return String(cell.v);
  }

  if (cell.w !== undefined) {
    return String(cell.w);
  }

  return cell.f ? `=${cell.f}` : "";
}

function normalizeHeader(value: unknown, index: number) {
  const header = toText(value);
  return header || `未命名列${index + 1}`;
}

function buildColumns(headerRow: unknown[]) {
  const counts = new Map<string, number>();

  return headerRow.map((cell, index) => {
    const header = normalizeHeader(cell, index);
    const count = counts.get(header) ?? 0;
    counts.set(header, count + 1);
    return count ? `${header}_${count + 1}` : header;
  });
}

function getCellAddresses(sheet: XlsxWorksheet, XLSX: typeof import("xlsx")) {
  return Object.keys(sheet)
    .filter((key) => !key.startsWith("!"))
    .map((cellAddress) => ({
      cellAddress,
      decoded: XLSX.utils.decode_cell(cellAddress),
    }));
}

function getUsedRange(sheet: XlsxWorksheet, XLSX: typeof import("xlsx"), cells: Array<{ decoded: XlsxCellAddress }>) {
  const refRange = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;

  if (!refRange && !cells.length) {
    return null;
  }

  return cells.reduce(
    (range, cell) => ({
      s: {
        r: Math.min(range.s.r, cell.decoded.r),
        c: Math.min(range.s.c, cell.decoded.c),
      },
      e: {
        r: Math.max(range.e.r, cell.decoded.r),
        c: Math.max(range.e.c, cell.decoded.c),
      },
    }),
    refRange ?? {
      s: { r: cells[0].decoded.r, c: cells[0].decoded.c },
      e: { r: cells[0].decoded.r, c: cells[0].decoded.c },
    },
  );
}

function parseSheet(sheetName: string, sheet: XlsxWorksheet, XLSX: typeof import("xlsx")): ParsedSheet | null {
  const cells = getCellAddresses(sheet, XLSX);
  const range = getUsedRange(sheet, XLSX, cells);

  if (!range) {
    return null;
  }

  let headerIndex = -1;
  let headerRow: unknown[] = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = Array.from({ length: range.e.c - range.s.c + 1 }, (_, offset) => {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: range.s.c + offset });

      return toCellText(sheet[cellAddress]);
    });

    if (row.some((cell) => toText(cell))) {
      headerIndex = rowIndex;
      headerRow = row;
      break;
    }
  }

  if (headerIndex < 0) {
    return null;
  }

  const columns = buildColumns(headerRow);
  const rows = Array.from({ length: range.e.r - headerIndex }, (_, index) => {
    const rowIndex = headerIndex + index + 1;
    const values = columns.reduce<Record<string, string>>((acc, column, columnIndex) => {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: range.s.c + columnIndex });
      acc[column] = toCellText(sheet[cellAddress]);
      return acc;
    }, {});

    return {
      rowNumber: rowIndex + 1,
      values,
    };
  }).filter((row) => Object.values(row.values).some((value) => toText(value)));

  return {
    sheetName,
    columns,
    rows,
  };
}

async function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, cellHTML: false, cellFormula: true });
  const sheets = workbook.SheetNames.reduce<ParsedSheet[]>((acc, sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const parsedSheet = sheet ? parseSheet(sheetName, sheet, XLSX) : null;

    if (parsedSheet) {
      acc.push(parsedSheet);
    }

    return acc;
  }, []);

  if (!sheets.length) {
    throw new Error(`${file.name} 没有可用于比较的数据。`);
  }

  return {
    fileName: file.name,
    sheets,
  };
}

export async function compareSaihuExcelRows(firstFile: File, secondFile: File): Promise<SaihuExcelDiffResult> {
  const [first, second] = await Promise.all([parseWorkbook(firstFile), parseWorkbook(secondFile)]);
  const firstSheets = new Map(first.sheets.map((sheet) => [sheet.sheetName, sheet]));
  const secondSheets = new Map(second.sheets.map((sheet) => [sheet.sheetName, sheet]));
  const sheetNames = Array.from(new Set([...firstSheets.keys(), ...secondSheets.keys()]));
  const columns = Array.from(new Set(first.sheets.concat(second.sheets).flatMap((sheet) => sheet.columns)));
  const rows: SaihuExcelDiffRow[] = [];
  let firstOnlyRows = 0;
  let secondOnlyRows = 0;
  let changedRows = 0;

  sheetNames.forEach((sheetName) => {
    const firstSheet = firstSheets.get(sheetName);
    const secondSheet = secondSheets.get(sheetName);
    const sheetColumns = Array.from(new Set([...(firstSheet?.columns ?? []), ...(secondSheet?.columns ?? [])]));
    const firstRows = firstSheet?.rows ?? [];
    const secondRows = secondSheet?.rows ?? [];
    const firstRowsByNumber = new Map(firstRows.map((row) => [row.rowNumber, row]));
    const secondRowsByNumber = new Map(secondRows.map((row) => [row.rowNumber, row]));
    const rowNumbers = Array.from(new Set([...firstRowsByNumber.keys(), ...secondRowsByNumber.keys()])).sort((left, right) => left - right);

    for (const rowNumber of rowNumbers) {
      const firstRow = firstRowsByNumber.get(rowNumber) ?? null;
      const secondRow = secondRowsByNumber.get(rowNumber) ?? null;
      const changedColumns = sheetColumns.filter((column) => (firstRow?.values[column] ?? "") !== (secondRow?.values[column] ?? ""));

      if (!changedColumns.length) continue;

      const pairKey = `${sheetName}-${rowNumber}`;

      if (firstRow && secondRow) {
        changedRows += 1;
      } else if (firstRow) {
        firstOnlyRows += 1;
      } else {
        secondOnlyRows += 1;
      }

      if (firstRow && rows.length < diffPreviewRowLimit) {
        rows.push({
          side: "first",
          sheetName,
          rowNumber: firstRow.rowNumber,
          values: firstRow.values,
          pairKey,
          changedColumns,
        });
      }

      if (secondRow && rows.length < diffPreviewRowLimit) {
        rows.push({
          side: "second",
          sheetName,
          rowNumber: secondRow.rowNumber,
          values: secondRow.values,
          pairKey,
          changedColumns,
        });
      }
    }
  });

  return {
    columns,
    summary: {
      firstFileName: first.fileName,
      secondFileName: second.fileName,
      firstSheetCount: first.sheets.length,
      secondSheetCount: second.sheets.length,
      comparedSheetCount: sheetNames.length,
      firstRows: first.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
      secondRows: second.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
      firstOnlyRows,
      secondOnlyRows,
      changedRows,
      totalDifferentRows: changedRows + firstOnlyRows + secondOnlyRows,
    },
    rows,
  };
}
