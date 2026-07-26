import * as XLSX from "xlsx";
import type { SaihuExcelDiffResult, SaihuExcelDiffRow } from "@/lib/saihu-search-merge/types";

interface ParsedSheet {
  sheetName: string;
  columns: string[];
  rows: Array<{
    rowNumber: number;
    values: Record<string, string>;
    signature: string;
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

function buildSignature(columns: string[], values: Record<string, string>) {
  return JSON.stringify(columns.map((column) => values[column] ?? ""));
}

function parseSheet(sheetName: string, sheet: XLSX.WorkSheet): ParsedSheet | null {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const headerRow = matrix.find((row) => row.some((cell) => toText(cell)));

  if (!headerRow) {
    return null;
  }

  const columns = buildColumns(headerRow);
  const headerIndex = matrix.indexOf(headerRow);
  const rows = matrix
    .slice(headerIndex + 1)
    .map((row, index) => {
      const values = columns.reduce<Record<string, string>>((acc, column, columnIndex) => {
        acc[column] = toText(row[columnIndex]);
        return acc;
      }, {});

      return {
        rowNumber: headerIndex + index + 2,
        values,
        signature: buildSignature(columns, values),
      };
    })
    .filter((row) => Object.values(row.values).some(Boolean));

  return {
    sheetName,
    columns,
    rows,
  };
}

async function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, cellHTML: false, cellFormula: true });
  const sheets = workbook.SheetNames.reduce<ParsedSheet[]>((acc, sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const parsedSheet = sheet ? parseSheet(sheetName, sheet) : null;

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

function countBySignature(rows: ParsedSheet["rows"]) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    counts.set(row.signature, (counts.get(row.signature) ?? 0) + 1);
  });
  return counts;
}

function collectDifferentRows(
  rows: ParsedSheet["rows"],
  otherCounts: Map<string, number>,
  side: SaihuExcelDiffRow["side"],
  sheetName: string,
): SaihuExcelDiffRow[] {
  const used = new Map<string, number>();

  return rows.reduce<SaihuExcelDiffRow[]>((acc, row) => {
    const matched = otherCounts.get(row.signature) ?? 0;
    const currentUsed = used.get(row.signature) ?? 0;
    used.set(row.signature, currentUsed + 1);

    if (currentUsed >= matched) {
      acc.push({
        side,
        sheetName,
        rowNumber: row.rowNumber,
        values: row.values,
      });
    }

    return acc;
  }, []);
}

export async function compareSaihuExcelRows(firstFile: File, secondFile: File): Promise<SaihuExcelDiffResult> {
  const [first, second] = await Promise.all([parseWorkbook(firstFile), parseWorkbook(secondFile)]);
  const firstSheets = new Map(first.sheets.map((sheet) => [sheet.sheetName, sheet]));
  const secondSheets = new Map(second.sheets.map((sheet) => [sheet.sheetName, sheet]));
  const sheetNames = Array.from(new Set([...firstSheets.keys(), ...secondSheets.keys()]));
  const columns = Array.from(new Set(first.sheets.concat(second.sheets).flatMap((sheet) => sheet.columns)));
  const firstOnlyRows: SaihuExcelDiffRow[] = [];
  const secondOnlyRows: SaihuExcelDiffRow[] = [];

  sheetNames.forEach((sheetName) => {
    const firstSheet = firstSheets.get(sheetName);
    const secondSheet = secondSheets.get(sheetName);
    const sheetColumns = Array.from(new Set([...(firstSheet?.columns ?? []), ...(secondSheet?.columns ?? [])]));
    const firstRows = firstSheet?.rows.map((row) => ({ ...row, signature: buildSignature(sheetColumns, row.values) })) ?? [];
    const secondRows = secondSheet?.rows.map((row) => ({ ...row, signature: buildSignature(sheetColumns, row.values) })) ?? [];

    firstOnlyRows.push(...collectDifferentRows(firstRows, countBySignature(secondRows), "first", sheetName));
    secondOnlyRows.push(...collectDifferentRows(secondRows, countBySignature(firstRows), "second", sheetName));
  });

  const rows = [...firstOnlyRows, ...secondOnlyRows];

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
      firstOnlyRows: firstOnlyRows.length,
      secondOnlyRows: secondOnlyRows.length,
      totalDifferentRows: rows.length,
    },
    rows,
  };
}
