import * as XLSX from "xlsx";

/**
 * Excel 解析的唯一实现。浏览器 Worker 与 Node/SSR fallback 都调用本模块，
 * 从而保证「worker 解析」与「主线程解析」是同一套逻辑，不再分叉成两条链。
 */
export type WorkbookParseOptions = {
  shape: "matrix" | "objects";
  /** objects 模式是否合并全部 sheet；matrix 模式固定取首个 sheet */
  allSheets?: boolean;
  cellDates?: boolean;
  raw?: boolean;
  defval?: string | number | boolean | null;
  blankrows?: boolean;
};

export type ParsedWorkbook<T> = {
  rows: T;
  sheetNames: string[];
};

type SheetMatrix = Array<Array<string | number | boolean | null>>;
type SheetRow = Record<string, string | number | boolean | null>;

export function parseWorkbookCore(file: ArrayBuffer, options: WorkbookParseOptions): ParsedWorkbook<SheetMatrix | SheetRow[]> {
  const {
    shape,
    allSheets = false,
    cellDates = false,
    raw = false,
    defval = "",
    blankrows,
  } = options;
  const workbook = XLSX.read(file, { type: "array", cellDates });
  const sheetNames = allSheets ? workbook.SheetNames : workbook.SheetNames.slice(0, 1);

  if (shape === "matrix") {
    const sheet = workbook.Sheets[sheetNames[0] ?? ""];
    const rows = sheet
      ? XLSX.utils.sheet_to_json<SheetMatrix[number]>(sheet, {
          header: 1,
          defval,
          raw,
          ...(blankrows === undefined ? {} : { blankrows }),
        })
      : [];
    return { rows, sheetNames: workbook.SheetNames };
  }

  const rows = sheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    return sheet ? XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval, raw }) : [];
  });
  return { rows, sheetNames: workbook.SheetNames };
}
