import type { ExportFormat, StructuredReport } from "./types";

/**
 * 报告导出：Excel 用 xlsx（项目既有依赖），Word 用最小 OOXML + JSZip（项目既有依赖，零新增）。
 * 不引入 docx 包——它会传递依赖 @types/node@26，污染全项目 ChildProcess 类型。
 * 只导出模型真实产出的内容；rows 为空时不伪造表格，缺失值保留 NEEDS_DATA。
 */

const MAX_ROWS = 5000;
const MAX_CELL = 32000;

function safeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "NEEDS_DATA";
  const text = String(value);
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}…` : text;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnKeys(rows: StructuredReport["rows"]): string[] {
  const keys: string[] = [];
  for (const row of rows.slice(0, 200)) {
    for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

export async function exportExcel(report: StructuredReport, fileName: string): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  const headers = columnKeys(report.rows);
  const matrix: (string | number | null)[][] = [];
  if (headers.length) {
    matrix.push(headers);
    for (const row of report.rows.slice(0, MAX_ROWS)) matrix.push(headers.map((key) => row[key] ?? null));
  } else {
    matrix.push(["说明"], ["当前报告未包含可导出的结构化数据行。"]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  sheet["!cols"] = headers.map((key) => ({ wch: Math.min(48, Math.max(12, key.length * 2 + 4)) }));
  XLSX.utils.book_append_sheet(workbook, sheet, "报告数据");

  const overview = XLSX.utils.aoa_to_sheet([
    ["报告标题", report.title],
    ["导出时间", new Date().toISOString()],
    ["数据说明", "数值均为模型基于已提供事实生成；未提供的事实标记 NEEDS_DATA，未做补零或估算。"],
    ["注意事项", "报告为分析建议，未执行任何店铺写入操作；写入请走主系统审批流程。"],
  ]);
  overview["!cols"] = [{ wch: 16 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, overview, "说明");

  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true });
  void fileName;
  return new Uint8Array(output as ArrayBuffer);
}

function paragraph(text: string, heading = false): string {
  if (!text.trim()) return "<w:p/>";
  const run = heading
    ? `<w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`
    : `<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
  return `<w:p>${run}</w:p>`;
}

function tableXml(headers: string[], rows: StructuredReport["rows"]): string {
  if (!headers.length) return "";
  const cell = (text: string, header = false) =>
    `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${header ? "<w:shd w:val=\"clear\" w:fill=\"E8EEF5\"/>" : ""}</w:tcPr>${paragraph(text)}</w:tc>`;
  const headRow = `<w:tr>${headers.map((key) => cell(key, true)).join("")}</w:tr>`;
  const bodyRows = rows.slice(0, MAX_ROWS).map((row) =>
    `<w:tr>${headers.map((key) => cell(safeCell(row[key]))).join("")}</w:tr>`,
  );
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>
    <w:top w:val="single" w:sz="4" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:color="CBD5E1"/>
    <w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:color="CBD5E1"/>
    <w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/>
  </w:tblBorders></w:tblPr>${headRow}${bodyRows.join("")}</w:tbl>`;
}

export async function exportWord(report: StructuredReport, title: string): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const blocks: string[] = [paragraph(report.title || title, true)];

  for (const raw of report.markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push("<w:p/>");
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    blocks.push(paragraph(heading ? heading[2] : line, Boolean(heading)));
  }

  const headers = columnKeys(report.rows);
  if (headers.length) {
    blocks.push(paragraph("结构化数据", true));
    blocks.push(tableXml(headers, report.rows));
  }
  if (report.notes?.length) {
    blocks.push(paragraph("说明", true));
    for (const note of report.notes) blocks.push(paragraph(`• ${note}`));
  }
  blocks.push(paragraph("本报告由 AI 基于已提供数据生成，未执行任何店铺写入操作。缺失事实标注 NEEDS_DATA，未做补零或估算。"));

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${blocks.join("")}<w:sectPr/></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("word/document.xml", documentXml);
  const output = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Uint8Array(output);
}

export async function exportReport(
  format: ExportFormat,
  report: StructuredReport,
  fileName: string,
): Promise<Uint8Array> {
  return format === "xlsx"
    ? exportExcel(report, fileName)
    : exportWord(report, fileName);
}
