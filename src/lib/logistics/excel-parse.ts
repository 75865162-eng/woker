import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import type { AProductRow, AWorkbookSummary, BWorkbookSummary, CWorkbookSummary, DWorkbookSummary, SaihuWorkbookSummary } from "@/lib/logistics/types";
import { parseNumber, toText } from "@/lib/logistics/utils";
import { getSheetMatrix, readWorkbookBuffer, type WorkbookInput } from "./excel-reader";

type ParseAWorkbookOptions = {
  skipImages?: boolean;
};

type ExcelJsMediaItem = {
  index?: number;
  buffer?: ArrayBuffer;
  extension?: string;
};

export function parseBoxNumberFromLabel(label: string, fallback: number) {
  const matched = label.match(/B(\d+)/iu);
  if (!matched) return fallback;
  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseBoxHeader(value: unknown) {
  const text = toText(value);
  const matched = text.match(/第?\s*(\d+)\s*箱?/u);
  if (!matched) {
    return null;
  }

  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function findPackageCount(matrix: (string | number | null)[][]) {
  const rowIndex = matrix.findIndex((row) => row.some((cell) => toText(cell).includes("包装箱总数")));
  if (rowIndex < 0) {
    return null;
  }

  const row = matrix[rowIndex] ?? [];
  const labelIndex = row.findIndex((cell) => toText(cell).includes("包装箱总数"));
  if (labelIndex < 0) {
    return null;
  }

  for (let index = labelIndex + 1; index < row.length; index += 1) {
    const parsed = parseNumber(row[index]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function hasAWorkbookHeaders(matrix: (string | number | null)[][]) {
  return matrix.some((row) =>
    row.some((cell) => {
      const text = toText(cell).replace(/\s+/g, "").toUpperCase();
      return text === "SKU" || text === "FNSKU" || text.includes("发货总数");
    }),
  );
}

function resolveAWorkbookSheetName(workbook: XLSX.WorkBook) {
  const sheetNames = [...workbook.SheetNames].reverse();
  return (
    sheetNames.find((sheetName) => hasAWorkbookHeaders(getSheetMatrix(workbook.Sheets[sheetName]))) ??
    workbook.SheetNames.at(-1) ??
    ""
  );
}


export async function parseAWorkbookBuffer(input: WorkbookInput, options: ParseAWorkbookOptions = {}): Promise<AWorkbookSummary> {
  const { workbook } = readWorkbookBuffer(input);
  const latestSheetName = resolveAWorkbookSheetName(workbook);

  if (!latestSheetName) {
    throw new Error("A表没有可读取的 sheet");
  }

  const sheet = workbook.Sheets[latestSheetName];
  const matrix = getSheetMatrix(sheet);
  const excelJsWorkbook = new ExcelJS.Workbook();
  const imageMap = new Map<number, { extension: string; data: Uint8Array }>();

  if (!options.skipImages) {
    await excelJsWorkbook.xlsx.load(input.buffer.slice(0));
    const excelJsSheet = excelJsWorkbook.getWorksheet(latestSheetName);

    if (excelJsSheet?.getImages) {
      for (const image of excelJsSheet.getImages()) {
        const imageId = Number(image.imageId);
        const media = (excelJsWorkbook.model.media as ExcelJsMediaItem[] | undefined)?.find((item) => item.index === imageId);
        if (!media?.buffer || !media.extension) {
          continue;
        }
        imageMap.set(image.range.tl.nativeRow + 1, {
          extension: media.extension,
          data: new Uint8Array(media.buffer),
        });
      }
    }
  }

  const headerRowIndex = matrix.findIndex((row) =>
    row.some((cell) => {
      const text = toText(cell);
      return text === "SKU" || text === "FNSKU" || text === "发货总数";
    }),
  );
  const headerRow = ((headerRowIndex >= 0 ? matrix[headerRowIndex] : matrix[2]) ?? []) as (string | number | null)[];

  const normalizeHeaderText = (value: unknown) => toText(value).replace(/\s+/g, "").toUpperCase();

  const findHeaderIndex = (patterns: string[]) =>
    headerRow.findIndex((cell) => {
      const text = normalizeHeaderText(cell);
      return patterns.some((pattern) => text.includes(pattern));
    });

  const findExactHeaderIndex = (labels: string[]) =>
    headerRow.findIndex((cell) => {
      const text = normalizeHeaderText(cell);
      return labels.some((label) => text === normalizeHeaderText(label));
    });

  const imageColIndex = findHeaderIndex(["产品图片", "图片"]);
  const productNameColIndex = findHeaderIndex(["品名", "产品名称"]);
  const asinColIndex = findExactHeaderIndex(["ASIN"]);
  const skuColIndex = findExactHeaderIndex(["SKU"]);
  const fnskuColIndex = findExactHeaderIndex(["FNSKU"]);
  const purchaseCostColIndex = findHeaderIndex(["采购成本", "价格", "单价"]);
  const packageSizeColIndex = findHeaderIndex(["包装尺寸", "尺寸"]);
  const packageWeightColIndex = findHeaderIndex(["毛重", "重量", "净重"]);
  const hsCodeColIndex = findHeaderIndex(["海关编码", "HS编码", "HS CODE"]);
  const explicitTotalShipmentColIndex = findHeaderIndex(["发货总数", "总发货", "最终发货"]);
  const fallbackShipmentColIndex = findExactHeaderIndex(["发货"]);
  const totalShipmentColIndex = explicitTotalShipmentColIndex >= 0 ? explicitTotalShipmentColIndex : fallbackShipmentColIndex;
  const remarkColIndex = findHeaderIndex(["备注"]);
  const firstBoxColIndex = headerRow.findIndex((value, index) => {
    const boxNo = parseNumber(value);
    if (boxNo === null || boxNo <= 0) {
      return false;
    }
    if (totalShipmentColIndex >= 0) {
      return index > totalShipmentColIndex;
    }
    if (remarkColIndex >= 0) {
      return index > remarkColIndex;
    }
    return index >= 12;
  });

  const boxHeaderEntries = headerRow
    .map((value, index) => ({ boxNo: parseNumber(value), index }))
    .filter((item) => item.boxNo !== null && item.boxNo > 0 && (firstBoxColIndex < 0 || item.index >= firstBoxColIndex));
  const boxHeaders = boxHeaderEntries.map((item) => item.boxNo as number);
  const boxColumnIndexMap = new Map<number, number>(boxHeaderEntries.map((item) => [item.boxNo as number, item.index]));

  const rows: AProductRow[] = [];

  for (let rowIndex = Math.max(headerRowIndex + 1, 3); rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const sku = toText(row[skuColIndex >= 0 ? skuColIndex : 4]);
    const totalShipment = parseNumber(row[totalShipmentColIndex >= 0 ? totalShipmentColIndex : 23]) ?? 0;

    if (!sku && totalShipment === 0) {
      continue;
    }

    const boxMap: Record<number, number> = {};

    boxHeaders.forEach((boxNo) => {
      const colIndex = boxColumnIndexMap.get(boxNo);
      if (colIndex === undefined) {
        return;
      }
      const value = parseNumber(row[colIndex]);
      if (value !== null && value !== 0) {
        boxMap[boxNo] = value;
      }
    });

    const packageWeightRaw = parseNumber(row[packageWeightColIndex >= 0 ? packageWeightColIndex : 6]);
    const packageWeightHeader = toText(headerRow[packageWeightColIndex >= 0 ? packageWeightColIndex : 6]).replace(/\s+/g, "");
    const packageWeightKg =
      packageWeightRaw === null
        ? null
        : packageWeightHeader.includes("克")
          ? Number((packageWeightRaw / 1000).toFixed(3))
          : packageWeightRaw;

    rows.push({
      rowIndex: rowIndex + 1,
      image: toText(row[imageColIndex >= 0 ? imageColIndex : 0]),
      imageAsset: imageMap.get(rowIndex + 1) ?? null,
      productName: toText(row[productNameColIndex >= 0 ? productNameColIndex : 1]),
      asin: toText(row[asinColIndex >= 0 ? asinColIndex : 2]),
      fnsku: toText(row[fnskuColIndex >= 0 ? fnskuColIndex : 3]),
      sku,
      packageSize: toText(row[packageSizeColIndex >= 0 ? packageSizeColIndex : 5]),
      packageWeightKg,
      hsCode: toText(row[hsCodeColIndex >= 0 ? hsCodeColIndex : 7]),
      purchaseCost: parseNumber(row[purchaseCostColIndex >= 0 ? purchaseCostColIndex : 12]),
      totalShipment,
      boxMap,
    });
  }

  const inlineMetricRow = (matrix[1] ?? []) as (string | number | null)[];
  const boxWeightRow = matrix.find((row) => toText(row[4]).toLowerCase() === "weight of box (kg)");
  const boxLengthRow = matrix.find((row) => toText(row[4]).toLowerCase() === "box length (cm)");
  const boxWidthRow = matrix.find((row) => toText(row[4]).toLowerCase() === "box width (cm)");
  const boxHeightRow = matrix.find((row) => toText(row[4]).toLowerCase() === "box height (cm)");

  const mapBoxMetric = (metricRow?: (string | number | null)[], inlineStartIndex?: number) =>
    Object.fromEntries(
      boxHeaders.map((boxNo, offset) => {
        const boxColIndex = boxColumnIndexMap.get(boxNo) ?? (firstBoxColIndex >= 0 ? firstBoxColIndex + offset : 24 + offset);
        const value =
          parseNumber(metricRow?.[boxColIndex]) ??
          (inlineStartIndex !== undefined ? parseNumber(inlineMetricRow[inlineStartIndex + offset]) : null) ??
          parseNumber(inlineMetricRow[boxColIndex]) ??
          parseNumber(metricRow?.[7 + boxNo - 1]) ??
          0;
        return [boxNo, value];
      }),
    ) as Record<number, number>;

  return {
    latestSheetName,
    totalRows: rows.length,
    totalBoxes: boxHeaders.length,
    totalShipment: rows.reduce((sum, row) => sum + row.totalShipment, 0),
    imageParsingSkipped: Boolean(options.skipImages),
    boxHeaders,
    boxWeightKgMap: mapBoxMetric(boxWeightRow, firstBoxColIndex >= 0 ? firstBoxColIndex : 24),
    boxLengthCmMap: mapBoxMetric(boxLengthRow),
    boxWidthCmMap: mapBoxMetric(boxWidthRow),
    boxHeightCmMap: mapBoxMetric(boxHeightRow),
    rows,
  };
}

export async function parseAWorkbook(file: File, options: ParseAWorkbookOptions = {}): Promise<AWorkbookSummary> {
  return parseAWorkbookBuffer({ buffer: await file.arrayBuffer(), fileName: file.name }, options);
}

export async function parseBWorkbook(): Promise<BWorkbookSummary> {
  return {
    templateType: "amazon-official",
    sheetNames: ["Create workflow – template"],
    templateSheetName: "Create workflow – template",
    headerRow: 6,
  };
}

export async function parseCWorkbookBuffer(input: WorkbookInput): Promise<CWorkbookSummary> {
  const { workbook } = readWorkbookBuffer(input);
  const sheetName =
    workbook.SheetNames.find((name) => name === "Pack List") ??
    workbook.SheetNames.find((name) => name === "包装箱包装信息") ??
    workbook.SheetNames[0] ??
    "";

  if (!sheetName) {
    throw new Error("C表没有可读取的 sheet");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = getSheetMatrix(sheet);
  const headerRowIndex = matrix.findIndex((row) => row.some((cell) => toText(cell) === "SKU" || toText(cell) === "第1箱" || toText(cell) === "第 1 箱"));
  const headerRow = headerRowIndex >= 0 ? matrix[headerRowIndex] ?? [] : matrix[1] ?? [];
  const detectedBoxHeaders = headerRow
    .map((value, index) => ({ boxNo: parseBoxHeader(value), index }))
    .filter((item) => item.index >= 0 && item.boxNo !== null)
    .map((item) => item.boxNo as number);

  const packageCount = findPackageCount(matrix);

  const isNewAmazonPackSheet = sheetName === "包装箱包装信息";
  const boxHeaders =
    isNewAmazonPackSheet && packageCount && packageCount > 0
      ? Array.from({ length: packageCount }, (_, index) => index + 1)
      : detectedBoxHeaders;

  const skuRows = matrix
    .slice(Math.max(headerRowIndex + 1, 0))
    .map((row) => {
      const skuIndex = headerRow.findIndex((cell) => toText(cell) === "SKU");
      return toText(row[skuIndex >= 0 ? skuIndex : 4]);
    })
    .filter(Boolean);

  return {
    sheetName,
    totalBoxes: boxHeaders.length,
    skuRows,
    boxHeaders,
  };
}

export async function parseCWorkbook(file: File): Promise<CWorkbookSummary> {
  return parseCWorkbookBuffer({ buffer: await file.arrayBuffer(), fileName: file.name });
}

export async function parseSaihuWorkbookBuffer(input: WorkbookInput): Promise<SaihuWorkbookSummary> {
  const { workbook } = readWorkbookBuffer(input);
  const sheetName = workbook.SheetNames[0] ?? null;
  if (!sheetName) {
    throw new Error("赛狐模板没有可读取的 sheet");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = getSheetMatrix(sheet);
  const defaultStore = toText(matrix[1]?.[0]) || toText(matrix[0]?.[0]) || "";

  return {
    sheetNames: workbook.SheetNames,
    sheetName,
    defaultStore,
  };
}

export async function parseSaihuWorkbook(file: File): Promise<SaihuWorkbookSummary> {
  return parseSaihuWorkbookBuffer({ buffer: await file.arrayBuffer(), fileName: file.name });
}

export async function parseDWorkbookBuffer(input: WorkbookInput): Promise<DWorkbookSummary> {
  const { workbook } = readWorkbookBuffer(input);

  return {
    sheetNames: workbook.SheetNames,
    templateSheetName: workbook.SheetNames.find((name) => name === "Sheet1") ?? workbook.SheetNames[0] ?? null,
    warehouseSheetName: workbook.SheetNames.find((name) => name === "FBA仓库地址") ?? null,
  };
}

export async function parseDWorkbook(file: File): Promise<DWorkbookSummary> {
  return parseDWorkbookBuffer({ buffer: await file.arrayBuffer(), fileName: file.name });
}
