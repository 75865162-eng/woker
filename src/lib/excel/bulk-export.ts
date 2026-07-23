import * as XLSX from "xlsx";
import JSZip from "jszip";
import type { AdjustmentDraft, DraftValidationResult, HeaderMap } from "@/lib/types";

type Worksheet = XLSX.WorkSheet;
type Workbook = XLSX.WorkBook;
type ValidatorIssue = {
  sheetName?: string;
  rowNumber?: number;
  columnName?: string;
  message: string;
};

const fieldHeaderCandidates = {
  bid: ["竞价", "Bid"],
  state: ["状态", "State"],
  operation: ["操作", "Operation"],
};
const identityHeaderCandidates = {
  entity: ["实体层级", "实体", "Entity", "Record Type"],
  id: ["ID", "Id", "id", "Campaign ID", "Ad Group ID", "Keyword ID", "Targeting ID", "Portfolio ID"],
};
const allowedChangedFields = new Set(["bid", "operation"]);
const excludedUploadSheetNames = new Set(["rassearchtermreport"]);

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[\s()[\]_\-:：（）]/g, "");
}

function normalizeSheetName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function shouldExcludeFromBulkUpload(sheetName: string) {
  return excludedUploadSheetNames.has(normalizeSheetName(sheetName));
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

function getHeaderEntryByCandidates(headerMap: HeaderMap, candidates: string[]) {
  return candidates.map(normalizeHeader).map((candidate) => headerMap[candidate]).find(Boolean);
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

  if (draft.field !== "bid") {
    return {
      draftId: draft.id,
      valid: false,
      status: "blocked",
      message: "当前导出仅允许写回竞价列和操作列。",
      sheetName: draft.sheetName,
      sourceRowIndex: draft.sourceRowIndex,
      headerName: draft.headerName,
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

  if (!validation.valid || !draft.sheetName || !draft.sourceRowIndex || draft.field !== "bid") {
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

function getCellValue(sheet: Worksheet, rowIndex: number, columnIndex: number) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  const cell = sheet[address];

  return cell?.v ?? "";
}

function normalizeComparableValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  return String(value).trim();
}

function getColumnHeader(sheet: Worksheet, range: XLSX.Range, columnIndex: number) {
  return normalizeComparableValue(getCellValue(sheet, range.s.r, columnIndex));
}

function getHeaderNames(sheet: Worksheet, range: XLSX.Range) {
  const headers: string[] = [];

  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    headers.push(getColumnHeader(sheet, range, columnIndex));
  }

  return headers;
}

function isConfigSheet(sheetName: string) {
  const normalized = normalizeSheetName(sheetName);

  return normalized.includes("config") || normalized.includes("配置") || normalized.includes("settings") || normalized.includes("setting");
}

function getAllowedChangedColumns(headerMap: HeaderMap) {
  const columns = new Set<number>();

  for (const field of allowedChangedFields) {
    const entry = getHeaderEntry(headerMap, field as "bid" | "state" | "operation");

    if (entry) {
      columns.add(entry.columnIndex);
    }
  }

  return columns;
}

function pushIssue(issues: ValidatorIssue[], issue: ValidatorIssue) {
  if (issues.length < 50) {
    issues.push(issue);
  }
}

function compareRanges(originalRange: XLSX.Range | null, exportedRange: XLSX.Range | null, sheetName: string, issues: ValidatorIssue[]) {
  if (!originalRange || !exportedRange) {
    if (Boolean(originalRange) !== Boolean(exportedRange)) {
      pushIssue(issues, { sheetName, message: "Sheet 空/非空状态不一致。" });
    }
    return false;
  }

  const originalRows = originalRange.e.r - originalRange.s.r + 1;
  const exportedRows = exportedRange.e.r - exportedRange.s.r + 1;
  const originalColumns = originalRange.e.c - originalRange.s.c + 1;
  const exportedColumns = exportedRange.e.c - exportedRange.s.c + 1;

  if (originalRows !== exportedRows) {
    pushIssue(issues, { sheetName, message: `行数不一致：原始 ${originalRows} 行，导出 ${exportedRows} 行。` });
  }

  if (originalColumns !== exportedColumns) {
    pushIssue(issues, { sheetName, message: `列数不一致：原始 ${originalColumns} 列，导出 ${exportedColumns} 列。` });
  }

  return originalRows === exportedRows && originalColumns === exportedColumns;
}

function compareSheetStructure(originalSheet: Worksheet, exportedSheet: Worksheet, sheetName: string, issues: ValidatorIssue[]) {
  const originalRange = getSheetRange(originalSheet);
  const exportedRange = getSheetRange(exportedSheet);
  const sameShape = compareRanges(originalRange, exportedRange, sheetName, issues);

  if (!originalRange || !exportedRange || !sameShape) {
    return;
  }

  const originalHeaders = getHeaderNames(originalSheet, originalRange);
  const exportedHeaders = getHeaderNames(exportedSheet, exportedRange);

  originalHeaders.forEach((header, index) => {
    const exportedHeader = exportedHeaders[index];

    if (normalizeComparableValue(header) !== normalizeComparableValue(exportedHeader)) {
      pushIssue(issues, {
        sheetName,
        columnName: columnName(originalRange.s.c + index),
        message: `Header 不一致：原始「${header}」，导出「${exportedHeader}」。`,
      });
    }
  });
}

function compareIdentityColumns(originalSheet: Worksheet, exportedSheet: Worksheet, sheetName: string, issues: ValidatorIssue[]) {
  const originalRange = getSheetRange(originalSheet);
  const exportedRange = getSheetRange(exportedSheet);

  if (!originalRange || !exportedRange) {
    return;
  }

  const originalHeaderMap = buildHeaderMap(originalSheet);
  const exportedHeaderMap = buildHeaderMap(exportedSheet);
  const identityFields = [
    { label: "Entity", candidates: identityHeaderCandidates.entity },
    { label: "ID", candidates: identityHeaderCandidates.id },
  ];

  for (const field of identityFields) {
    const originalEntry = getHeaderEntryByCandidates(originalHeaderMap, field.candidates);
    const exportedEntry = getHeaderEntryByCandidates(exportedHeaderMap, field.candidates);

    if (!originalEntry && !exportedEntry) {
      continue;
    }

    if (!originalEntry || !exportedEntry || originalEntry.columnIndex !== exportedEntry.columnIndex) {
      pushIssue(issues, { sheetName, message: `${field.label} 列位置不一致。` });
      continue;
    }

    for (let rowIndex = originalRange.s.r + 1; rowIndex <= originalRange.e.r; rowIndex += 1) {
      const originalValue = normalizeComparableValue(getCellValue(originalSheet, rowIndex, originalEntry.columnIndex));
      const exportedValue = normalizeComparableValue(getCellValue(exportedSheet, rowIndex, exportedEntry.columnIndex));

      if (originalValue !== exportedValue) {
        pushIssue(issues, {
          sheetName,
          rowNumber: rowIndex + 1,
          columnName: originalEntry.headerName,
          message: `${field.label} 不一致：原始「${originalValue}」，导出「${exportedValue}」。`,
        });
        break;
      }
    }
  }
}

function compareAllowedChanges(originalSheet: Worksheet, exportedSheet: Worksheet, sheetName: string, issues: ValidatorIssue[]) {
  const originalRange = getSheetRange(originalSheet);
  const exportedRange = getSheetRange(exportedSheet);

  if (!originalRange || !exportedRange) {
    return;
  }

  const originalHeaderMap = buildHeaderMap(originalSheet);
  const allowedColumns = getAllowedChangedColumns(originalHeaderMap);
  const maxRow = Math.max(originalRange.e.r, exportedRange.e.r);
  const maxColumn = Math.max(originalRange.e.c, exportedRange.e.c);

  for (let rowIndex = originalRange.s.r; rowIndex <= maxRow; rowIndex += 1) {
    for (let columnIndex = originalRange.s.c; columnIndex <= maxColumn; columnIndex += 1) {
      const originalValue = normalizeComparableValue(getCellValue(originalSheet, rowIndex, columnIndex));
      const exportedValue = normalizeComparableValue(getCellValue(exportedSheet, rowIndex, columnIndex));

      if (originalValue === exportedValue) {
        continue;
      }

      if (isConfigSheet(sheetName)) {
        pushIssue(issues, {
          sheetName,
          rowNumber: rowIndex + 1,
          columnName: columnName(columnIndex),
          message: "Config Sheet 不允许被修改。",
        });
        return;
      }

      if (!allowedColumns.has(columnIndex)) {
        pushIssue(issues, {
          sheetName,
          rowNumber: rowIndex + 1,
          columnName: getColumnHeader(originalSheet, originalRange, columnIndex) || columnName(columnIndex),
          message: `发现非允许字段变化：原始「${originalValue}」，导出「${exportedValue}」。`,
        });
      }
    }
  }
}

export function validateBulkExport(originalBuffer: ArrayBuffer, exportedBuffer: ArrayBuffer) {
  const originalWorkbook = XLSX.read(originalBuffer, { type: "array" });
  const exportedWorkbook = XLSX.read(exportedBuffer, { type: "array" });
  const originalUploadSheetNames = originalWorkbook.SheetNames.filter((sheetName) => !shouldExcludeFromBulkUpload(sheetName));
  const exportedUploadSheetNames = exportedWorkbook.SheetNames.filter((sheetName) => !shouldExcludeFromBulkUpload(sheetName));
  const issues: ValidatorIssue[] = [];

  if (exportedWorkbook.SheetNames.some(shouldExcludeFromBulkUpload)) {
    pushIssue(issues, {
      message: "导出文件仍包含 RAS Search Term Report，请删除该报告 Sheet 后再上传 Amazon。",
    });
  }

  if (originalUploadSheetNames.length !== exportedUploadSheetNames.length) {
    pushIssue(issues, {
      message: `Sheet 数量不一致：原始 ${originalUploadSheetNames.length} 个，导出 ${exportedUploadSheetNames.length} 个。`,
    });
  }

  originalUploadSheetNames.forEach((sheetName, index) => {
    const exportedSheetName = exportedUploadSheetNames[index];

    if (sheetName !== exportedSheetName) {
      pushIssue(issues, {
        sheetName,
        message: `Sheet 名称/顺序不一致：原始「${sheetName}」，导出「${exportedSheetName ?? "缺失"}」。`,
      });
    }
  });

  for (const sheetName of originalUploadSheetNames) {
    const originalSheet = originalWorkbook.Sheets[sheetName];
    const exportedSheet = exportedWorkbook.Sheets[sheetName];

    if (!exportedSheet) {
      continue;
    }

    compareSheetStructure(originalSheet, exportedSheet, sheetName, issues);
    compareIdentityColumns(originalSheet, exportedSheet, sheetName, issues);
    compareAllowedChanges(originalSheet, exportedSheet, sheetName, issues);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
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

function getSheetXmlPaths(zip: JSZip) {
  const workbookXml = zip.file("xl/workbook.xml")?.async("string");
  const relationshipsXml = zip.file("xl/_rels/workbook.xml.rels")?.async("string");

  return Promise.all([workbookXml, relationshipsXml]).then(([workbookText, relationshipsText]) => {
    if (!workbookText || !relationshipsText) {
      throw new Error("Workbook 结构不完整，无法定位 Sheet XML。");
    }

    const parser = new DOMParser();
    const workbookDoc = parser.parseFromString(workbookText, "application/xml");
    const relationshipsDoc = parser.parseFromString(relationshipsText, "application/xml");
    const relationshipById = new Map<string, string>();

    Array.from(relationshipsDoc.getElementsByTagName("Relationship")).forEach((relationship) => {
      const id = relationship.getAttribute("Id");
      const target = relationship.getAttribute("Target");

      if (id && target) {
        relationshipById.set(id, resolveWorkbookRelationshipTarget(target));
      }
    });

    return Array.from(workbookDoc.getElementsByTagName("sheet")).reduce<Map<string, string>>((map, sheet) => {
      const name = sheet.getAttribute("name");
      const relationshipId = sheet.getAttribute("r:id");
      const target = relationshipId ? relationshipById.get(relationshipId) : undefined;

      if (name && target) {
        map.set(name, target);
      }

      return map;
    }, new Map());
  });
}

async function removeExcludedUploadSheets(zip: JSZip) {
  const workbookText = await zip.file("xl/workbook.xml")?.async("string");
  const relationshipsText = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");

  if (!workbookText || !relationshipsText) {
    return;
  }

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const workbookDoc = parser.parseFromString(workbookText, "application/xml");
  const relationshipsDoc = parser.parseFromString(relationshipsText, "application/xml");
  const relationshipById = new Map<string, Element>();
  const removedTargets: string[] = [];

  Array.from(relationshipsDoc.getElementsByTagName("Relationship")).forEach((relationship) => {
    const id = relationship.getAttribute("Id");

    if (id) {
      relationshipById.set(id, relationship);
    }
  });

  Array.from(workbookDoc.getElementsByTagName("sheet")).forEach((sheet) => {
    const name = sheet.getAttribute("name") ?? "";
    const relationshipId = sheet.getAttribute("r:id");

    if (!shouldExcludeFromBulkUpload(name) || !relationshipId) {
      return;
    }

    const relationship = relationshipById.get(relationshipId);
    const target = relationship?.getAttribute("Target");

    if (target) {
      removedTargets.push(resolveWorkbookRelationshipTarget(target));
    }

    relationship?.parentNode?.removeChild(relationship);
    sheet.parentNode?.removeChild(sheet);
  });

  if (!removedTargets.length) {
    return;
  }

  for (const target of removedTargets) {
    zip.remove(target);
  }

  zip.file("xl/workbook.xml", serializer.serializeToString(workbookDoc));
  zip.file("xl/_rels/workbook.xml.rels", serializer.serializeToString(relationshipsDoc));
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

function patchSheetXml(sheetXml: string, updates: Array<{ cellRef: string; value: string | number }>) {
  if (!updates.length) {
    return sheetXml;
  }

  const updatesByRow = updates.reduce<Map<number, Array<{ cellRef: string; value: string | number }>>>((map, update) => {
    const rowNumber = getRowNumberFromCellRef(update.cellRef);

    map.set(rowNumber, [...(map.get(rowNumber) ?? []), update]);
    return map;
  }, new Map());
  const patchedRows = new Set<number>();
  const patchedXml = sheetXml.replace(/<row\b(?=[^>]*\br="(\d+)")[\s\S]*?<\/row>/g, (rowXml, rowNumberText: string) => {
    const rowNumber = Number(rowNumberText);
    const rowUpdates = updatesByRow.get(rowNumber);

    if (!rowUpdates?.length) {
      return rowXml;
    }

    patchedRows.add(rowNumber);
    return rowUpdates.reduce((currentRowXml, update) => replaceCellInRowXml(currentRowXml, update.cellRef, update.value), rowXml);
  });
  const missingRows = Array.from(updatesByRow.entries()).filter(([rowNumber]) => !patchedRows.has(rowNumber));

  if (!missingRows.length) {
    return patchedXml;
  }

  const sheetDataEnd = patchedXml.indexOf("</sheetData>");

  if (sheetDataEnd < 0) {
    throw new Error("Sheet XML 缺少 sheetData，无法写回。");
  }

  const rowXml = missingRows
    .sort(([left], [right]) => left - right)
    .map(([rowNumber, rowUpdates]) => {
      const cellsXml = rowUpdates
        .sort((left, right) => getColumnIndexFromCellRef(left.cellRef) - getColumnIndexFromCellRef(right.cellRef))
        .map((update) => buildCellXml(update.cellRef, update.value))
        .join("");

      return `<row r="${rowNumber}">${cellsXml}</row>`;
    })
    .join("");

  return `${patchedXml.slice(0, sheetDataEnd)}${rowXml}${patchedXml.slice(sheetDataEnd)}`;
}

async function patchWorkbookBuffer(input: {
  workbookBuffer: ArrayBuffer;
  workbook: Workbook;
  drafts: AdjustmentDraft[];
}) {
  const zip = await JSZip.loadAsync(input.workbookBuffer);
  await removeExcludedUploadSheets(zip);
  const sheetXmlPaths = await getSheetXmlPaths(zip);
  const draftsBySheetName = input.drafts.reduce<Map<string, AdjustmentDraft[]>>((map, draft) => {
    if (!draft.sheetName || shouldExcludeFromBulkUpload(draft.sheetName)) {
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

    const sheetXml = await sheetXmlFile.async("string");
    const headerMap = buildHeaderMap(sheet);
    const updates: Array<{ cellRef: string; value: string | number }> = [];

    for (const draft of sheetDrafts) {
      if (!draft.sourceRowIndex || draft.field !== "bid" || draft.newValue === undefined) {
        continue;
      }

      const targetCell = getCellByField(sheet, headerMap, draft.sourceRowIndex, draft.field);
      const operationCell = getCellByField(sheet, headerMap, draft.sourceRowIndex, "operation");

      if (targetCell) {
        updates.push({ cellRef: targetCell, value: draft.newValue });
      }

      if (operationCell) {
        updates.push({ cellRef: operationCell, value: "Update" });
      }
    }

    zip.file(sheetXmlPath, patchSheetXml(sheetXml, updates));
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
  const validator = validateBulkExport(input.workbookBuffer, output);

  if (!validator.valid) {
    const issueText = validator.issues
      .slice(0, 10)
      .map((issue) => {
        const location = [issue.sheetName, issue.rowNumber ? `第 ${issue.rowNumber} 行` : undefined, issue.columnName]
          .filter(Boolean)
          .join(" / ");

        return `${location ? `${location}: ` : ""}${issue.message}`;
      })
      .join("\n");

    throw new Error(`Upload Validator 未通过，已阻止导出：\n${issueText}`);
  }

  return {
    data: output,
    fileName: input.fileName ?? "modified-bulk-operations.xlsx",
    validations,
    writableCount,
    blockedCount: validations.filter((item) => item.status === "blocked").length,
    conflictCount: validations.filter((item) => item.status === "conflict").length,
  };
}
