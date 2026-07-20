import * as XLSX from "xlsx";
import JSZip from "jszip";
import type { AdjustmentDraft, DraftValidationResult, HeaderMap } from "@/lib/types";

type Worksheet = XLSX.WorkSheet;
type Workbook = XLSX.WorkBook;

const fieldHeaderCandidates = {
  bid: ["竞价", "Bid"],
  state: ["状态", "State"],
  operation: ["操作", "Operation"],
};

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[\s()[\]_\-:：（）]/g, "");
}

function columnName(columnIndex: number) {
  let column = "";
  let index = columnIndex + 1;

  while (index > 0) {
    const remainder = (index - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    index = Math.floor((index - 1) / 26);
  }

  return column;
}

function getSheetRange(sheet: Worksheet) {
  return sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
}

export function buildHeaderMap(sheet: Worksheet): HeaderMap {
  const range = getSheetRange(sheet);
  const headerMap: HeaderMap = {};

  if (!range) {
    return headerMap;
  }

  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const address = XLSX.utils.encode_cell({ r: range.s.r, c: columnIndex });
    const headerName = String(sheet[address]?.v ?? "").trim();

    if (!headerName) {
      continue;
    }

    headerMap[normalizeHeader(headerName)] = {
      headerName,
      columnIndex,
      excelColumn: columnName(columnIndex),
    };
  }

  return headerMap;
}

export function getHeaderEntry(headerMap: HeaderMap, field: "bid" | "state" | "operation") {
  const candidates = fieldHeaderCandidates[field].map(normalizeHeader);
  return candidates.map((candidate) => headerMap[candidate]).find(Boolean);
}

export function getCellByField(
  _sheet: Worksheet,
  headerMap: HeaderMap,
  rowIndex: number,
  field: "bid" | "state" | "operation",
) {
  const entry = getHeaderEntry(headerMap, field);

  if (!entry) {
    return null;
  }

  return XLSX.utils.encode_cell({ r: rowIndex - 1, c: entry.columnIndex });
}

export function validateDraftCellTarget(workbook: Workbook, draft: AdjustmentDraft): DraftValidationResult {
  if (!draft.selected) {
    return {
      draftId: draft.id,
      valid: false,
      status: "blocked",
      message: "草稿未勾选，不允许写回。",
    };
  }

  if (!draft.sheetName || !draft.sourceRowIndex || !draft.field) {
    return {
      draftId: draft.id,
      valid: false,
      status: "blocked",
      message: "草稿缺少 Sheet、原始行号或写回字段。",
    };
  }

  const sheet = workbook.Sheets[draft.sheetName];

  if (!sheet) {
    return {
      draftId: draft.id,
      valid: false,
      status: "blocked",
      message: "目标 Sheet 不存在。",
      sheetName: draft.sheetName,
      sourceRowIndex: draft.sourceRowIndex,
      headerName: draft.headerName,
    };
  }

  const range = getSheetRange(sheet);

  if (!range || draft.sourceRowIndex < 1 || draft.sourceRowIndex > range.e.r + 1) {
    return {
      draftId: draft.id,
      valid: false,
      status: "blocked",
      message: "原始行号不存在。",
      sheetName: draft.sheetName,
      sourceRowIndex: draft.sourceRowIndex,
      headerName: draft.headerName,
    };
  }

  const headerMap = buildHeaderMap(sheet);
  const cellAddress = getCellByField(sheet, headerMap, draft.sourceRowIndex, draft.field);

  if (!cellAddress) {
    return {
      draftId: draft.id,
      valid: false,
      status: "blocked",
      message: "目标写回列不存在。",
      sheetName: draft.sheetName,
      sourceRowIndex: draft.sourceRowIndex,
      headerName: draft.headerName,
    };
  }

  const currentValue = sheet[cellAddress]?.v ?? null;

  if (String(currentValue ?? "") !== String(draft.oldValue ?? "")) {
    return {
      draftId: draft.id,
      valid: false,
      status: "conflict",
      message: "当前单元格值与草稿原值不一致，已阻止写回。",
      sheetName: draft.sheetName,
      sourceRowIndex: draft.sourceRowIndex,
      headerName: draft.headerName,
    };
  }

  return {
    draftId: draft.id,
    valid: true,
    status: "valid",
    message: "可安全写回。",
    sheetName: draft.sheetName,
    sourceRowIndex: draft.sourceRowIndex,
    headerName: draft.headerName,
  };
}

export function applyDraftToWorkbook(workbook: Workbook, draft: AdjustmentDraft): Workbook {
  const validation = validateDraftCellTarget(workbook, draft);

  if (!validation.valid || !draft.sheetName || !draft.sourceRowIndex || !draft.field) {
    return workbook;
  }

  const sheet = workbook.Sheets[draft.sheetName];
  const headerMap = buildHeaderMap(sheet);
  const targetCell = getCellByField(sheet, headerMap, draft.sourceRowIndex, draft.field);
  const operationCell = getCellByField(sheet, headerMap, draft.sourceRowIndex, "operation");

  if (targetCell) {
    sheet[targetCell] = { t: typeof draft.newValue === "number" ? "n" : "s", v: draft.newValue };
  }

  if (operationCell) {
    sheet[operationCell] = { t: "s", v: "Update" };
  }

  return workbook;
}

function getColumnIndexFromCellRef(cellRef: string) {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";

  return letters.split("").reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
}

function getRowNumberFromCellRef(cellRef: string) {
  return Number(cellRef.match(/\d+$/)?.[0] ?? 0);
}

function normalizeZipPath(path: string) {
  return path.replace(/^\/+/, "").replace(/\/+/g, "/");
}

function resolveWorkbookRelationshipTarget(target: string) {
  const normalizedTarget = normalizeZipPath(target);

  if (normalizedTarget.startsWith("xl/")) {
    return normalizedTarget;
  }

  return normalizeZipPath(`xl/${normalizedTarget}`);
}

function getXmlAttribute(xml: string, name: string) {
  const match = xml.match(new RegExp(`\\b${escapeRegExp(name)}="([^"]*)"`));
  return match?.[1];
}

function getSheetXmlPaths(zip: JSZip) {
  const workbookXml = zip.file("xl/workbook.xml")?.async("string");
  const relationshipsXml = zip.file("xl/_rels/workbook.xml.rels")?.async("string");

  return Promise.all([workbookXml, relationshipsXml]).then(([workbookText, relationshipsText]) => {
    if (!workbookText || !relationshipsText) {
      throw new Error("Workbook 结构不完整，无法定位 Sheet XML。");
    }

    const relationshipById = new Map<string, string>();

    for (const relationshipMatch of relationshipsText.matchAll(/<Relationship\b[^>]*>/g)) {
      const relationshipXml = relationshipMatch[0];
      const id = getXmlAttribute(relationshipXml, "Id");
      const target = getXmlAttribute(relationshipXml, "Target");

      if (id && target) {
        relationshipById.set(id, resolveWorkbookRelationshipTarget(target));
      }
    }

    return Array.from(workbookText.matchAll(/<sheet\b[^>]*>/g)).reduce<Map<string, string>>((map, sheetMatch) => {
      const sheetXml = sheetMatch[0];
      const name = getXmlAttribute(sheetXml, "name");
      const relationshipId = getXmlAttribute(sheetXml, "r:id");
      const target = relationshipId ? relationshipById.get(relationshipId) : undefined;

      if (name && target) {
        map.set(name, target);
      }

      return map;
    }, new Map());
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXmlText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extractPreservedCellAttributes(cellXml: string) {
  return cellXml.match(/\bs="[^"]*"/)?.[0] ?? "";
}

function buildCellXml(cellRef: string, value: string | number, existingCellXml?: string) {
  const styleAttribute = existingCellXml ? extractPreservedCellAttributes(existingCellXml) : "";
  const preservedAttributes = styleAttribute ? ` ${styleAttribute}` : "";

  if (typeof value === "number") {
    return `<c r="${cellRef}"${preservedAttributes}><v>${value}</v></c>`;
  }

  return `<c r="${cellRef}"${preservedAttributes} t="inlineStr"><is><t>${escapeXmlText(value)}</t></is></c>`;
}

function replaceCellInRowXml(rowXml: string, cellRef: string, value: string | number) {
  const cellPattern = new RegExp(`<c\\b(?=[^>]*\\br="${escapeRegExp(cellRef)}")[\\s\\S]*?(?:</c>|/>)`);
  const existingCellMatch = rowXml.match(cellPattern);

  if (existingCellMatch) {
    return rowXml.replace(cellPattern, buildCellXml(cellRef, value, existingCellMatch[0]));
  }

  const cellXml = buildCellXml(cellRef, value);
  const targetColumnIndex = getColumnIndexFromCellRef(cellRef);
  const cellMatches = Array.from(rowXml.matchAll(/<c\b(?=[^>]*\br="([A-Z]+[0-9]+)")[\s\S]*?(?:<\/c>|\/>)/g));
  const nextCell = cellMatches.find((match) => getColumnIndexFromCellRef(match[1]) > targetColumnIndex);

  if (nextCell?.index !== undefined) {
    return `${rowXml.slice(0, nextCell.index)}${cellXml}${rowXml.slice(nextCell.index)}`;
  }

  return rowXml.replace("</row>", `${cellXml}</row>`);
}

function patchCellXml(sheetXml: string, cellRef: string, value: string | number) {
  const rowNumber = getRowNumberFromCellRef(cellRef);
  const rowPattern = new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[\\s\\S]*?</row>`);

  if (rowPattern.test(sheetXml)) {
    return sheetXml.replace(rowPattern, (rowXml) => replaceCellInRowXml(rowXml, cellRef, value));
  }

  const sheetDataEnd = sheetXml.indexOf("</sheetData>");

  if (sheetDataEnd < 0) {
    throw new Error("Sheet XML 缺少 sheetData，无法写回。");
  }

  const rowXml = `<row r="${rowNumber}">${buildCellXml(cellRef, value)}</row>`;
  return `${sheetXml.slice(0, sheetDataEnd)}${rowXml}${sheetXml.slice(sheetDataEnd)}`;
}

async function patchWorkbookBuffer(input: {
  workbookBuffer: ArrayBuffer;
  workbook: Workbook;
  drafts: AdjustmentDraft[];
}) {
  const zip = await JSZip.loadAsync(input.workbookBuffer);
  const sheetXmlPaths = await getSheetXmlPaths(zip);
  const draftsBySheetName = input.drafts.reduce<Map<string, AdjustmentDraft[]>>((map, draft) => {
    if (!draft.sheetName) {
      return map;
    }

    map.set(draft.sheetName, [...(map.get(draft.sheetName) ?? []), draft]);
    return map;
  }, new Map());

  for (const [sheetName, sheetDrafts] of draftsBySheetName.entries()) {
    const sheetXmlPath = sheetXmlPaths.get(sheetName);
    const sheetXmlFile = sheetXmlPath ? zip.file(sheetXmlPath) : null;
    const sheet = input.workbook.Sheets[sheetName];

    if (!sheetXmlPath || !sheetXmlFile || !sheet) {
      continue;
    }

    let sheetXml = await sheetXmlFile.async("string");
    const headerMap = buildHeaderMap(sheet);

    for (const draft of sheetDrafts) {
      if (!draft.sourceRowIndex || !draft.field || draft.newValue === undefined) {
        continue;
      }

      const targetCell = getCellByField(sheet, headerMap, draft.sourceRowIndex, draft.field);
      const operationCell = getCellByField(sheet, headerMap, draft.sourceRowIndex, "operation");

      if (targetCell) {
        sheetXml = patchCellXml(sheetXml, targetCell, draft.newValue);
      }

      if (operationCell) {
        sheetXml = patchCellXml(sheetXml, operationCell, "Update");
      }
    }

    zip.file(sheetXmlPath, sheetXml);
  }

  return zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function exportSelectedDrafts(input: {
  workbookBuffer: ArrayBuffer;
  drafts: AdjustmentDraft[];
  fileName?: string;
}) {
  const workbook = XLSX.read(input.workbookBuffer, { type: "array" });
  const selectedDrafts = input.drafts.filter((draft) => draft.selected);
  const validations = selectedDrafts.map((draft) => validateDraftCellTarget(workbook, draft));
  const writableDrafts = selectedDrafts.filter((draft) => validations.find((item) => item.draftId === draft.id)?.valid);
  const writableCount = validations.filter((item) => item.valid).length;
  const output = await patchWorkbookBuffer({
    workbookBuffer: input.workbookBuffer,
    workbook,
    drafts: writableDrafts,
  });

  return {
    data: output,
    fileName: input.fileName ?? "modified-bulk-operations.xlsx",
    validations,
    writableCount,
    blockedCount: validations.filter((item) => item.status === "blocked").length,
    conflictCount: validations.filter((item) => item.status === "conflict").length,
  };
}
