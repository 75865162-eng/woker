import * as XLSX from "xlsx";

export type WorkbookWithSheets = {
  workbook: XLSX.WorkBook;
  fileName: string;
};

export type WorkbookInput = {
  buffer: ArrayBuffer;
  fileName: string;
};

export function readWorkbookBuffer(input: WorkbookInput): WorkbookWithSheets {
  const workbook = XLSX.read(input.buffer, { type: "array", cellDates: true, cellHTML: false, cellFormula: true });
  return { workbook, fileName: input.fileName };
}

export async function readWorkbook(file: File): Promise<WorkbookWithSheets> {
  return readWorkbookBuffer({ buffer: await file.arrayBuffer(), fileName: file.name });
}

export function getSheetMatrix(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });
}

export function columnNumberToName(column: number) {
  let current = column;
  let name = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
}

export function buildCellRef(row: number, col: number) {
  return `${columnNumberToName(col)}${row}`;
}
