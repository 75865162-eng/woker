import * as XLSX from "xlsx";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import type {
  AProductRow,
  AWorkbookSummary,
  BWorkbookSummary,
  CWorkbookSummary,
  DWorkbookSummary,
  NamedWorkbookExportResult,
  PdfSummary,
  SaihuWorkbookSummary,
  WorkbookExportResult,
} from "@/lib/logistics/types";
import { parseNumber, toText } from "@/lib/logistics/utils";

type WorkbookWithSheets = {
  workbook: XLSX.WorkBook;
  fileName: string;
};

type WorkbookInput = {
  buffer: ArrayBuffer;
  fileName: string;
};

type ParseAWorkbookOptions = {
  skipImages?: boolean;
};

type ExcelJsMediaItem = {
  index?: number;
  buffer?: ArrayBuffer;
  extension?: string;
};

type ExcelImageExtension = "jpeg" | "png" | "gif";

function normalizeImageExtension(extension: string): ExcelImageExtension {
  const normalized = extension.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") {
    return "jpeg";
  }
  if (normalized === "png" || normalized === "gif") {
    return normalized;
  }
  return "png";
}

export function readWorkbookBuffer(input: WorkbookInput): WorkbookWithSheets {
  const workbook = XLSX.read(input.buffer, { type: "array", cellDates: true, cellHTML: false, cellFormula: true });
  return { workbook, fileName: input.fileName };
}

export async function readWorkbook(file: File): Promise<WorkbookWithSheets> {
  return readWorkbookBuffer({ buffer: await file.arrayBuffer(), fileName: file.name });
}

function getSheetMatrix(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });
}

function columnNumberToName(column: number) {
  let current = column;
  let name = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
}

function buildCellRef(row: number, col: number) {
  return `${columnNumberToName(col)}${row}`;
}

function parseBoxNumberFromLabel(label: string, fallback: number) {
  const matched = label.match(/B(\d+)/iu);
  if (!matched) {
    return fallback;
  }
  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function resolveRowImage(row: AProductRow) {
  if (row.imageAsset) {
    return {
      buffer: row.imageAsset.data,
      extension: normalizeImageExtension(row.imageAsset.extension),
    };
  }

  const imageUrl = row.image.trim();
  if (!/^https?:\/\//iu.test(imageUrl)) {
    return null;
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type") || "";
    const extension =
      contentType.includes("png") ? "png" :
      contentType.includes("webp") ? "png" :
      "jpeg";
    return {
      buffer: new Uint8Array(await response.arrayBuffer()),
      extension: normalizeImageExtension(extension),
    };
  } catch {
    return null;
  }
}

const thinBorder = {
  top: { style: "thin" as const },
  left: { style: "thin" as const },
  bottom: { style: "thin" as const },
  right: { style: "thin" as const },
};

const warehouseColorPalette = [
  "FFD9EAF7",
  "FFEADCF8",
  "FFFCE4D6",
  "FFE2F0D9",
  "FFFFF2CC",
  "FFF4CCCC",
  "FFDDEBF7",
];

const templateColumnWidths = [15.1640625, 13, 11.5, 10.83203125];
const templateBoxColumnWidth = 13;
const templateRowHeights = {
  1: 16,
  2: 16,
  3: 28,
  4: 17,
  5: 35,
  17: 33,
  18: 29,
  19: 29,
  20: 28,
  21: 28,
};

function normalizeSharedFormulas(worksheet: ExcelJS.Worksheet) {
  worksheet.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const currentValue = cell.value;
      if (!currentValue || typeof currentValue !== "object") {
        return;
      }

      if ("formula" in currentValue && currentValue.formula) {
        cell.value = {
          formula: currentValue.formula,
          result: "result" in currentValue ? currentValue.result : undefined,
        };
        return;
      }

      if ("sharedFormula" in currentValue && currentValue.sharedFormula) {
        cell.value = {
          formula: cell.formula,
          result: "result" in currentValue ? currentValue.result : undefined,
        };
      }
    });
  });
}

function upsertNumericCell(sheetXml: string, cellRef: string, value: number) {
  const rowNumber = Number(cellRef.replace(/^[A-Z]+/u, ""));
  const cellRegex = new RegExp(`(<c[^>]*r="${cellRef}"[^>]*>)([\\s\\S]*?)(</c>)`, "u");

  if (cellRegex.test(sheetXml)) {
    return sheetXml.replace(cellRegex, (_match, startTag, innerXml, endTag) => {
      if (/<v>[\s\S]*?<\/v>/u.test(innerXml)) {
        return `${startTag}${innerXml.replace(/<v>[\s\S]*?<\/v>/u, `<v>${value}</v>`)}${endTag}`;
      }

      if (/<f>[\s\S]*?<\/f>/u.test(innerXml)) {
        return `${startTag}${innerXml}<v>${value}</v>${endTag}`;
      }

      return `${startTag}<v>${value}</v>${endTag}`;
    });
  }

  const rowRegex = new RegExp(`(<row[^>]*r="${rowNumber}"[^>]*>)([\\s\\S]*?)(</row>)`, "u");
  if (rowRegex.test(sheetXml)) {
    return sheetXml.replace(rowRegex, (_match, startTag, innerXml, endTag) => `${startTag}${innerXml}<c r="${cellRef}"><v>${value}</v></c>${endTag}`);
  }

  return sheetXml;
}

function parseBoxHeader(value: unknown) {
  const text = toText(value);
  const matched = text.match(/第?\s*(\d+)\s*箱?/u);
  if (!matched) {
    return null;
  }

  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function findPackageCount(matrix: (string | number | null)[][]) {
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

export async function parseAWorkbookBuffer(input: WorkbookInput, options: ParseAWorkbookOptions = {}): Promise<AWorkbookSummary> {
  const { workbook } = readWorkbookBuffer(input);
  const latestSheetName = workbook.SheetNames.at(-1) ?? "";

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

export async function buildBWorkbookFromTemplateBuffer(
  aSummary: AWorkbookSummary,
  templateBuffer: ArrayBuffer,
): Promise<WorkbookExportResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer.slice(0));
  const sheetName = "Create workflow 鈥?template";
  const sheet = workbook.getWorksheet(sheetName);

  if (!sheet) {
    throw new Error("B琛ㄧ己灏?Create workflow 鈥?template");
  }

  const rows = aSummary.rows.filter((row) => row.totalShipment > 0);
  const dataStartRow = 8;

  rows.forEach((row, index) => {
    const excelRowNumber = dataStartRow + index + 1;
    sheet.getCell(`A${excelRowNumber}`).value = row.sku;
    sheet.getCell(`B${excelRowNumber}`).value = row.totalShipment;
  });

  const maxRow = Math.max(dataStartRow + rows.length, 64);
  for (let rowNumber = dataStartRow + rows.length; rowNumber <= maxRow; rowNumber += 1) {
    sheet.getCell(`A${rowNumber + 1}`).value = null;
    sheet.getCell(`B${rowNumber + 1}`).value = null;
  }

  workbook.creator = "";
  workbook.lastModifiedBy = "";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);

  const output = await workbook.xlsx.writeBuffer();

  return {
    fileName: "ManifestFileUpload_Template_IncludeCasePack_IncludeExpirationDate_IncludeMLC_MPL.xlsx",
    data: output,
    blob: new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  };
}

export async function buildBWorkbook(aSummary: AWorkbookSummary): Promise<WorkbookExportResult> {
  const response = await fetch("/logistics-templates/ManifestFileUpload_Template_IncludeCasePack_IncludeExpirationDate_IncludeMLC_MPL.xlsx");
  if (!response.ok) {
    throw new Error("未找到内置的亚马逊官方 Create workflow 模板");
  }

  const buffer = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetName = "Create workflow – template";
  const sheet = workbook.getWorksheet(sheetName);

  if (!sheet) {
    throw new Error("B表缺少 Create workflow – template");
  }

  const rows = aSummary.rows.filter((row) => row.totalShipment > 0);
  const dataStartRow = 8;

  rows.forEach((row, index) => {
    const excelRowNumber = dataStartRow + index + 1;
    sheet.getCell(`A${excelRowNumber}`).value = row.sku;
    sheet.getCell(`B${excelRowNumber}`).value = row.totalShipment;
  });

  const maxRow = Math.max(dataStartRow + rows.length, 64);
  for (let rowNumber = dataStartRow + rows.length; rowNumber <= maxRow; rowNumber += 1) {
    sheet.getCell(`A${rowNumber + 1}`).value = null;
    sheet.getCell(`B${rowNumber + 1}`).value = null;
  }

  workbook.creator = "";
  workbook.lastModifiedBy = "";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);

  const output = await workbook.xlsx.writeBuffer();

  return {
    fileName: "ManifestFileUpload_Template_IncludeCasePack_IncludeExpirationDate_IncludeMLC_MPL.xlsx",
    data: output,
    blob: new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  };
}

export async function buildCWorkbook(file: File, aSummary: AWorkbookSummary): Promise<WorkbookExportResult> {
  const buffer = await file.arrayBuffer();
  const xlsxWorkbook = XLSX.read(buffer, { type: "array", cellDates: true, cellHTML: false, cellFormula: true });
  const sheetName =
    xlsxWorkbook.SheetNames.find((name) => name === "Pack List") ??
    xlsxWorkbook.SheetNames.find((name) => name === "包装箱包装信息");

  if (!sheetName) {
    throw new Error("C表缺少 Pack List 或 包装箱包装信息");
  }

  const sheet = xlsxWorkbook.Sheets[sheetName];
  const matrix = getSheetMatrix(sheet);
  const headerRowIndex = matrix.findIndex((row) => row.some((cell) => toText(cell) === "SKU" || toText(cell) === "第1箱" || toText(cell) === "第 1 箱"));
  const headerRow = headerRowIndex >= 0 ? matrix[headerRowIndex] ?? [] : matrix[1] ?? [];
  const skuColIndex = headerRow.findIndex((cell) => toText(cell) === "SKU");
  const boxColIndexMap = new Map<number, number>();
  const isNewAmazonPackSheet = sheetName === "包装箱包装信息";

  if (isNewAmazonPackSheet) {
    const packageCount = findPackageCount(matrix);

    if (!packageCount || packageCount <= 0) {
      throw new Error("新版 C 表未识别到包装箱总数");
    }

    for (let boxNo = 1; boxNo <= packageCount; boxNo += 1) {
      boxColIndexMap.set(boxNo, 13 + boxNo - 1);
    }
  } else {
    headerRow.forEach((cell, index) => {
      const boxNo = parseBoxHeader(cell);
      if (boxNo !== null) {
        boxColIndexMap.set(boxNo, index + 1);
      }
    });
  }

  const skuRowNumberMap = new Map<string, number>();

  matrix.forEach((row, index) => {
    const sku = toText(row[skuColIndex >= 0 ? skuColIndex : 4]);
    if (sku) {
      skuRowNumberMap.set(sku, index + 1);
    }
  });

  const metricRowMap = {
    weight: matrix.findIndex((row) => row.some((cell) => toText(cell).includes("包装箱重量") || toText(cell).toLowerCase() === "weight of box (kg)")) + 1,
    width: matrix.findIndex((row) => row.some((cell) => toText(cell).includes("包装箱宽度") || toText(cell).toLowerCase() === "box width (cm)")) + 1,
    length: matrix.findIndex((row) => row.some((cell) => toText(cell).includes("包装箱长度") || toText(cell).toLowerCase() === "box length (cm)")) + 1,
    height: matrix.findIndex((row) => row.some((cell) => toText(cell).includes("包装箱高度") || toText(cell).toLowerCase() === "box height (cm)")) + 1,
  };
  const zip = await JSZip.loadAsync(buffer);
  const targetSheetPath = sheetName === "包装箱包装信息" ? "xl/worksheets/sheet2.xml" : "xl/worksheets/sheet1.xml";
  const originalSheetXml = await zip.file(targetSheetPath)?.async("string");

  if (!originalSheetXml) {
    throw new Error("未找到 C 表对应的 worksheet xml");
  }

  let patchedSheetXml = originalSheetXml;

  aSummary.rows.forEach((product) => {
    const sheetRowNumber = skuRowNumberMap.get(product.sku);
    if (sheetRowNumber === undefined) {
      return;
    }

    for (const [boxNoText, qty] of Object.entries(product.boxMap)) {
      const boxNo = Number(boxNoText);
      const colIndex = boxColIndexMap.get(boxNo);
      if (colIndex === undefined) {
        continue;
      }
      patchedSheetXml = upsertNumericCell(patchedSheetXml, buildCellRef(sheetRowNumber, colIndex), qty);
    }
  });

  aSummary.boxHeaders.forEach((boxNo) => {
    const colIndex = boxColIndexMap.get(boxNo);
    if (colIndex === undefined) {
      return;
    }
    if (metricRowMap.weight > 0) {
      const weightLb = Math.round((aSummary.boxWeightKgMap[boxNo] ?? 0) / 0.454);
      patchedSheetXml = upsertNumericCell(patchedSheetXml, buildCellRef(metricRowMap.weight, colIndex), weightLb);
    }
    if (metricRowMap.width > 0) {
      patchedSheetXml = upsertNumericCell(patchedSheetXml, buildCellRef(metricRowMap.width, colIndex), 18);
    }
    if (metricRowMap.length > 0) {
      patchedSheetXml = upsertNumericCell(patchedSheetXml, buildCellRef(metricRowMap.length, colIndex), 17);
    }
    if (metricRowMap.height > 0) {
      patchedSheetXml = upsertNumericCell(patchedSheetXml, buildCellRef(metricRowMap.height, colIndex), 16);
    }
  });

  zip.file(targetSheetPath, patchedSheetXml);
  const output = await zip.generateAsync({ type: "uint8array" });
  const outputData = new Uint8Array(output).buffer;
  const outputBytes = Array.from(output);

  return {
    fileName: file.name,
    data: outputData,
    blob: new Blob([new Uint8Array(outputBytes)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  };
}

export async function buildSaihuWorkbook(file: File, aSummary: AWorkbookSummary): Promise<WorkbookExportResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, cellHTML: false, cellFormula: true });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("赛狐模板缺少可用工作表");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = getSheetMatrix(sheet);
  const defaultStore = toText(matrix[1]?.[0]) || toText(matrix[0]?.[0]) || "";
  const rows = aSummary.rows.filter((row) => row.totalShipment > 0);

  const dataRows = rows.map((row) => [defaultStore, row.sku, row.totalShipment, ""]);
  const rebuiltSheet = XLSX.utils.aoa_to_sheet([
    matrix[0] ?? ["*店铺", "*MSKU", "*申报数", "商品有效期（YYYY/MM/DD）"],
    ...dataRows,
  ]);
  workbook.Sheets[sheetName] = rebuiltSheet;

  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

  return {
    fileName: file.name,
    data: output,
    blob: new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  };
}

export async function buildSummaryWorkbook(aSummary: AWorkbookSummary, pdfSummary: PdfSummary | null): Promise<WorkbookExportResult> {
  const workbook = XLSX.utils.book_new();
  const boxHeaders = aSummary.boxHeaders.map((boxNo) => String(boxNo));
  const header = [
    "SKU",
    "品名",
    "最终发货",
    "海关编码",
    "采购成本",
    "仓库名称",
    "货件号",
    "FBA编号",
    "物流渠道",
    "重量/kg",
    ...boxHeaders,
  ];

  const data = aSummary.rows.map((row) => [
    row.sku,
    row.productName,
    row.totalShipment,
    row.hsCode,
    row.purchaseCost ?? "",
    pdfSummary?.warehouseCode ?? "",
    pdfSummary?.shipmentName ?? "",
    pdfSummary?.fbaCode ?? "",
    pdfSummary?.channelName ?? "",
    Object.entries(row.boxMap)
      .map(([boxNo]) => aSummary.boxWeightKgMap[Number(boxNo)] ?? "")
      .filter(Boolean)
      .join(" / "),
    ...aSummary.boxHeaders.map((boxNo) => row.boxMap[boxNo] ?? ""),
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...data]);
  XLSX.utils.book_append_sheet(workbook, sheet, "装箱汇总表");

  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

  return {
    fileName: `装箱汇总表_${Date.now()}.xlsx`,
    data: output,
    blob: new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  };
}

export async function buildComparisonWorkbook(aSummary: AWorkbookSummary, pdfSummaries: PdfSummary[]): Promise<WorkbookExportResult> {
  const response = await fetch("/logistics-templates/6.30-%E5%88%9B%E8%B4%A7%E4%BB%B6%E5%AF%B9%E6%AF%94%E8%A1%A8.xlsx");
  if (!response.ok) {
    throw new Error("未找到内置的创货件对比表模板");
  }

  const buffer = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("优化货件") ?? workbook.worksheets[0];

  if (!worksheet) {
    throw new Error("创货件对比表模板缺少可用工作表");
  }

  normalizeSharedFormulas(worksheet);

  const shippedRows = aSummary.rows.filter((row) => row.totalShipment > 0);
  const pages = pdfSummaries.flatMap((pdf) =>
    pdf.pages.map((page) => {
      const columnLabel = page.positionCode || `P1-B${page.pageNumber}`;
      return {
        ...page,
        warehouseCode: page.warehouseCode || pdf.warehouseCode,
        shipmentName: page.shipmentName || pdf.shipmentName,
        weightKg: aSummary.boxWeightKgMap[page.pageNumber] ?? 0,
        columnLabel,
        channelName: pdf.channelName || "",
        boxNo: parseBoxNumberFromLabel(columnLabel, page.pageNumber),
      };
    }),
  );
  const sortedBoxNos = [...aSummary.boxHeaders].sort((left, right) => left - right);
  const pageByBoxNo = new Map<number, (typeof pages)[number]>();
  pages.forEach((page) => {
    if (!pageByBoxNo.has(page.boxNo)) {
      pageByBoxNo.set(page.boxNo, page);
    }
  });

  const boxColumns = sortedBoxNos.map((boxNo) => {
    const page = pageByBoxNo.get(boxNo);
    return {
      boxNo,
      weightKg: aSummary.boxWeightKgMap[boxNo] ?? 0,
      warehouseCode: page?.warehouseCode || "",
      shipmentName: page?.shipmentName || "",
      channelName: page?.channelName || "",
      columnLabel: page?.columnLabel || `P1-B${boxNo}`,
    };
  });
  const warehouseFillMap = new Map<string, string>();
  let paletteIndex = 0;
  boxColumns.forEach((column) => {
    const key = column.warehouseCode || "__empty__";
    if (!warehouseFillMap.has(key)) {
      warehouseFillMap.set(key, warehouseColorPalette[paletteIndex % warehouseColorPalette.length]);
      paletteIndex += 1;
    }
  });

  const headerEndColumn = 4 + boxColumns.length;
  const dataStartRow = 6;
  const templateDataStartRow = 6;
  const templateDataEndRow = 16;
  const templateTailStartRow = 17;
  const baseColumnCount = 4;
  const templateMaxColumn = Math.max(worksheet.columnCount, 45);
  const lastTemplateDataColumn = Math.max(templateMaxColumn, headerEndColumn);
  const extraRowCount = Math.max(shippedRows.length - (templateDataEndRow - templateDataStartRow + 1), 0);

  if (extraRowCount > 0) {
    worksheet.spliceRows(templateTailStartRow, 0, ...Array.from({ length: extraRowCount }, () => []));
  }

  const tailStartRow = templateTailStartRow + extraRowCount;
  const logisticsChannelRow = tailStartRow;
  const logisticsPriceRow = tailStartRow + 1;
  const logisticsFeeRow = tailStartRow + 2;
  const inboundFeeRow = tailStartRow + 3;
  const totalFeeRow = tailStartRow + 4;

  for (let columnNumber = 1; columnNumber <= Math.max(templateMaxColumn, headerEndColumn); columnNumber += 1) {
    const currentWidth = worksheet.getColumn(columnNumber).width;
    if (columnNumber <= baseColumnCount) {
      worksheet.getColumn(columnNumber).width = currentWidth ?? templateColumnWidths[columnNumber - 1] ?? 12;
      continue;
    }
    worksheet.getColumn(columnNumber).width = currentWidth ?? templateBoxColumnWidth;
  }

  worksheet.getCell("D1").value = "重量/kg";
  worksheet.getCell("D2").value = "数量";
  worksheet.getCell("D3").value = "仓库名称";
  worksheet.getCell("D4").value = "货件号";
  worksheet.getCell("A5").value = "产品图片";
  worksheet.getCell("B5").value = "品名";
  worksheet.getCell("C5").value = "SKU";
  worksheet.getCell("D5").value = "最终发货";

  for (let columnNumber = 5; columnNumber <= templateMaxColumn; columnNumber += 1) {
    const columnName = columnNumberToName(columnNumber);
    const isUsed = columnNumber <= headerEndColumn;
    worksheet.getCell(`${columnName}1`).value = isUsed ? "" : null;
    worksheet.getCell(`${columnName}2`).value = isUsed ? "" : null;
    worksheet.getCell(`${columnName}3`).value = isUsed ? "" : null;
    worksheet.getCell(`${columnName}4`).value = isUsed ? "" : null;
    worksheet.getCell(`${columnName}5`).value = isUsed ? "" : null;
  }

  boxColumns.forEach((column, pageIndex) => {
    const columnNumber = 5 + pageIndex;
    const columnName = columnNumberToName(columnNumber);
    worksheet.getCell(`${columnName}1`).value = column.weightKg || "";
    worksheet.getCell(`${columnName}2`).value = {
      formula: `SUM(${columnName}${dataStartRow}:${columnName}${dataStartRow + shippedRows.length - 1})`,
    };
    worksheet.getCell(`${columnName}3`).value = column.warehouseCode || "--";
    worksheet.getCell(`${columnName}4`).value = column.shipmentName || "--";
    worksheet.getCell(`${columnName}5`).value = column.columnLabel;
  });

  for (let rowNumber = dataStartRow; rowNumber < tailStartRow; rowNumber += 1) {
    worksheet.getCell(`A${rowNumber}`).value = "";
    worksheet.getCell(`B${rowNumber}`).value = "";
    worksheet.getCell(`C${rowNumber}`).value = "";
    worksheet.getCell(`D${rowNumber}`).value = "";
    for (let columnNumber = 5; columnNumber <= lastTemplateDataColumn; columnNumber += 1) {
      worksheet.getCell(rowNumber, columnNumber).value = "";
    }
  }

  shippedRows.forEach((row, index) => {
    const rowNumber = dataStartRow + index;
    worksheet.getCell(`A${rowNumber}`).value = "";
    worksheet.getCell(`B${rowNumber}`).value = row.productName || "";
    worksheet.getCell(`C${rowNumber}`).value = row.sku || "";
    worksheet.getCell(`D${rowNumber}`).value = {
      formula: `SUM(E${rowNumber}:${columnNumberToName(headerEndColumn)}${rowNumber})`,
    };
    boxColumns.forEach(({ boxNo }, pageIndex) => {
      worksheet.getCell(rowNumber, 5 + pageIndex).value = row.boxMap[boxNo] ?? "";
    });
  });

  for (let rowNumber = tailStartRow; rowNumber <= totalFeeRow; rowNumber += 1) {
    for (let columnNumber = 5; columnNumber <= templateMaxColumn; columnNumber += 1) {
      worksheet.getCell(rowNumber, columnNumber).value = columnNumber <= headerEndColumn ? worksheet.getCell(rowNumber, columnNumber).value : "";
    }
  }

  worksheet.getCell(`D${logisticsChannelRow}`).value = "物流渠道";
  worksheet.getCell(`D${logisticsPriceRow}`).value = "物流单价";
  worksheet.getCell(`D${logisticsFeeRow}`).value = "物流费用";
  worksheet.getCell(`D${inboundFeeRow}`).value = "入库配置费（美金）";
  worksheet.getCell(`D${totalFeeRow}`).value = "总费用";

  boxColumns.forEach((column, pageIndex) => {
    const columnNumber = 5 + pageIndex;
    const columnName = columnNumberToName(columnNumber);
    worksheet.getCell(`${columnName}${logisticsChannelRow}`).value = column.channelName || "--";
    worksheet.getCell(`${columnName}${logisticsPriceRow}`).value = "";
    worksheet.getCell(`${columnName}${logisticsFeeRow}`).value = {
      formula: `${columnName}${logisticsPriceRow}*${columnName}1`,
    };
    worksheet.getCell(`${columnName}${inboundFeeRow}`).value = pageIndex === 0 ? 0 : "";
  });

  if (boxColumns.length) {
    worksheet.getCell(`E${totalFeeRow}`).value = {
      formula: `SUM(E${logisticsFeeRow}:${columnNumberToName(headerEndColumn)}${logisticsFeeRow})+E${inboundFeeRow}*7.2`,
    };
  }

  Object.entries(templateRowHeights).forEach(([rowNumber, height]) => {
    worksheet.getRow(Number(rowNumber)).height = height;
  });

  shippedRows.forEach((_, index) => {
    const rowNumber = dataStartRow + index;
    const cycleHeights = [69, 79, 87];
    worksheet.getRow(rowNumber).height = worksheet.getRow(rowNumber).height ?? cycleHeights[index % cycleHeights.length];
  });

  for (let rowNumber = templateDataEndRow + 1; rowNumber < tailStartRow; rowNumber += 1) {
    worksheet.getRow(rowNumber).height = worksheet.getRow(templateDataEndRow).height ?? 72;
  }

  worksheet.getRow(logisticsChannelRow).height = worksheet.getRow(templateTailStartRow).height ?? 33;
  worksheet.getRow(logisticsPriceRow).height = worksheet.getRow(templateTailStartRow + 1).height ?? 29;
  worksheet.getRow(logisticsFeeRow).height = worksheet.getRow(templateTailStartRow + 2).height ?? 29;
  worksheet.getRow(inboundFeeRow).height = worksheet.getRow(templateTailStartRow + 3).height ?? 28;
  worksheet.getRow(totalFeeRow).height = worksheet.getRow(templateTailStartRow + 4).height ?? 28;

  boxColumns.forEach((column, pageIndex) => {
    const columnNumber = 5 + pageIndex;
    const color = warehouseFillMap.get(column.warehouseCode || "__empty__") || "FFE2F0D9";
    [3, 4].forEach((rowNumber) => {
      worksheet.getCell(rowNumber, columnNumber).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: color },
      };
    });
    worksheet.getCell(5, columnNumber).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF92D050" },
    };
    worksheet.getCell(5, columnNumber).numFmt = "@";
  });

  for (let rowNumber = 1; rowNumber <= totalFeeRow; rowNumber += 1) {
    for (let columnNumber = 4; columnNumber <= headerEndColumn; columnNumber += 1) {
      worksheet.getCell(rowNumber, columnNumber).border = thinBorder;
    }
  }

  for (let columnNumber = 1; columnNumber <= 3; columnNumber += 1) {
    for (let rowNumber = 5; rowNumber < tailStartRow; rowNumber += 1) {
      worksheet.getCell(rowNumber, columnNumber).border = thinBorder;
    }
  }

  worksheet.getCell(`D${totalFeeRow}`).font = { bold: true, color: { argb: "FFFF0000" } };
  if (boxColumns.length) {
    worksheet.getCell(`E${totalFeeRow}`).font = { bold: true, color: { argb: "FFFF0000" } };
  }

  for (const [rowIndex, row] of shippedRows.entries()) {
    const resolvedImage = await resolveRowImage(row);
    if (!resolvedImage) {
      continue;
    }
    const imageId = workbook.addImage({
      base64: Buffer.from(resolvedImage.buffer).toString("base64"),
      extension: resolvedImage.extension,
    });
    const targetRow = 6 + rowIndex;
    worksheet.addImage(imageId, {
      tl: { col: 0.12, row: targetRow - 1 + 0.08 },
      ext: { width: 56, height: 56 },
      editAs: "oneCell",
    });
  }

  const output = await workbook.xlsx.writeBuffer();

  return {
    fileName: `创货件对比表_${Date.now()}.xlsx`,
    data: output,
    blob: new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  };
}

function inferEnglishName(productName: string, sku: string) {
  const samples: Record<string, string> = {
    "0E-7MD5-T78E": "Sand Bag",
    "PP-4VL0-SDK2": "Softball Sleeve Holders",
    "LJ-98F8-THD5": "Soccer Armband",
    "U3-UBDP-WLQY": "Softball Sleeve Holders",
    "5J-APYY-A5SU": "Golf Cart Flag",
    "9M-JWM6-20L1": "Sand Bag",
    "KA-USA Flag": "Golf Cart Flag",
    "KA-pickleball court": "Pickleball Court Marking Kit",
    "B8-FISN-297Q": "Diving Flag Mount",
    "KA-Handicap Flag": "Golf Cart Flag",
    "T-SANDBAG-BLK-L": "Sand Bag",
  };

  if (samples[sku]) {
    return samples[sku];
  }

  return productName || "";
}

function buildDLinesForPdf(aSummary: AWorkbookSummary, pdfSummary: PdfSummary) {
  const lines: Array<{
    boxNo: number;
    fbaBoxCode: string;
    weightKg: number;
    hsCode: string;
    productNameCn: string;
    productNameEn: string;
    qtyPerBox: number;
    declarePrice: number | "";
    image: string;
  }> = [];

  pdfSummary.pages.forEach((page, pageIndex) => {
    const boxNo = page.pageNumber;
    const weightKg = aSummary.boxWeightKgMap[boxNo] ?? 0;

    const matchedProducts = aSummary.rows.filter((row) => (row.boxMap[boxNo] ?? 0) > 0);

    if (!matchedProducts.length) {
      lines.push({
        boxNo,
        fbaBoxCode: page.fbaBoxCode,
        weightKg,
        hsCode: "",
        productNameCn: "",
        productNameEn: "",
        qtyPerBox: page.qty ?? 0,
        declarePrice: "",
        image: "",
      });
      return;
    }

    matchedProducts.forEach((product) => {
      lines.push({
        boxNo,
        fbaBoxCode: page.fbaBoxCode,
        weightKg,
        hsCode: product.hsCode,
        productNameCn: product.productName,
        productNameEn: inferEnglishName(product.productName, product.sku),
        qtyPerBox: product.boxMap[boxNo] ?? 0,
        declarePrice: product.purchaseCost ? Number((product.purchaseCost / 8).toFixed(2)) : "",
        image: product.image,
      });
    });

    if (page.skuType === "Single SKU" && page.sku) {
      const hasMatchedSku = matchedProducts.some((product) => product.sku.replace(/\s+/g, "") === page.sku.replace(/\s+/g, ""));
      if (!hasMatchedSku) {
        // Current version trusts A table as source of truth but keeps the page mapping by box number.
        void pageIndex;
      }
    }
  });

  return lines;
}

export async function buildDWorkbooks(
  aSummary: AWorkbookSummary,
  pdfSummaries: PdfSummary[],
  templateId = "kaiqi",
): Promise<NamedWorkbookExportResult[]> {
  if (templateId !== "kaiqi") {
    throw new Error("当前只支持凯奇物流模板");
  }

  const response = await fetch("/logistics-templates/kaiqi-logistics-template.xlsx");
  if (!response.ok) {
    throw new Error("未找到内置的凯奇物流模板");
  }

  const buffer = await response.arrayBuffer();
  const exports: NamedWorkbookExportResult[] = [];

  for (const pdfSummary of pdfSummaries) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer.slice(0));
    const sheet = workbook.getWorksheet("Sheet1");

    if (!sheet) {
      throw new Error("D表缺少 Sheet1");
    }

    normalizeSharedFormulas(sheet);

    sheet.getCell("B3").value = pdfSummary.fbaCode;
    sheet.getCell("E3").value = pdfSummary.warehouseCode;
    sheet.getCell("B4").value = pdfSummary.channelName || "";
    sheet.getCell("B5").value = "美国";
    sheet.getCell("B6").value = pdfSummary.pages.length;
    sheet.getCell("B7").value = "一般报关";
    sheet.getCell("B8").value = "是";
    sheet.getCell("B11").value = "否";

    const lines = buildDLinesForPdf(aSummary, pdfSummary);
    const dataStartRow = 16;
    const templateLastRow = 22;
    const templateCapacity = templateLastRow - dataStartRow + 1;
    const extraRows = Math.max(lines.length - templateCapacity, 0);
    const maxColumns = Math.max(sheet.columnCount, 21);
    const templateSourceRow = sheet.getRow(dataStartRow);

    if (extraRows > 0) {
      sheet.spliceRows(templateLastRow + 1, 0, ...Array.from({ length: extraRows }, () => []));
    }

    for (let index = 0; index < lines.length; index += 1) {
      const rowNumber = dataStartRow + index;
      if (rowNumber <= templateLastRow) {
        continue;
      }

      const targetRow = sheet.getRow(rowNumber);
      targetRow.height = templateSourceRow.height;

      for (let columnNumber = 1; columnNumber <= maxColumns; columnNumber += 1) {
        const sourceCell = templateSourceRow.getCell(columnNumber);
        const targetCell = targetRow.getCell(columnNumber);
        targetCell.style = JSON.parse(JSON.stringify(sourceCell.style ?? {}));
        if (sourceCell.numFmt) {
          targetCell.numFmt = sourceCell.numFmt;
        }
      }
    }

    lines.forEach((line, index) => {
      const rowNumber = dataStartRow + index;
      sheet.getCell(`A${rowNumber}`).value = line.boxNo;
      sheet.getCell(`B${rowNumber}`).value = line.fbaBoxCode;
      sheet.getCell(`C${rowNumber}`).value = "";
      sheet.getCell(`D${rowNumber}`).value = line.weightKg || "";
      sheet.getCell(`E${rowNumber}`).value = 50;
      sheet.getCell(`F${rowNumber}`).value = 40;
      sheet.getCell(`G${rowNumber}`).value = 40;
      sheet.getCell(`H${rowNumber}`).value = line.hsCode;
      sheet.getCell(`I${rowNumber}`).value = line.productNameCn;
      sheet.getCell(`J${rowNumber}`).value = line.productNameEn;
      sheet.getCell(`K${rowNumber}`).value = line.qtyPerBox || "";
      sheet.getCell(`L${rowNumber}`).value = line.declarePrice;
      sheet.getCell(`M${rowNumber}`).value = "无";
      sheet.getCell(`N${rowNumber}`).value = "无";
      sheet.getCell(`O${rowNumber}`).value = "尼龙/Nylon";
      sheet.getCell(`P${rowNumber}`).value = "户外/Outdoor";
      sheet.getCell(`Q${rowNumber}`).value = line.image;
      sheet.getCell(`R${rowNumber}`).value = "";
      sheet.getCell(`S${rowNumber}`).value = "";
      sheet.getCell(`T${rowNumber}`).value = "";
      sheet.getCell(`U${rowNumber}`).value = "";
    });

    const output = await workbook.xlsx.writeBuffer();
    const fileName = pdfSummary.renamedFileName.replace(/\.pdf$/i, ".xlsx");

    exports.push({
      key: pdfSummary.fileNameBase,
      fileName,
      data: output,
      blob: new Blob([output], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    });
  }

  return exports;
}
